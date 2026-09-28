# @ishan/ecosystem-auth

The **optional** identity sidecar for the ecosystem surfaces. It builds a
[Better Auth](https://better-auth.com) instance from an injected config and
exposes it through the one interface the rest of the ecosystem already speaks:
the `SessionPorts` port defined by `@ishan/ecosystem-core/auth`.

Status: **v0.1.0 — scaffolded and verified, not yet adopted by any surface.**
Nothing consumes it in production. The first intended consumer is
`technical-authority-website`, and only once a route actually needs accounts.

## Why this is a separate package

`@ishan/ecosystem-core` has a binding contract: no `$env`, no `node:*`, no
module-level singletons, dependency-free, runs on Workers and Node. Better Auth
is a real payload (Better Auth + Kysely + a Postgres driver). Putting it in core
would break that contract for every consumer, including the ones with no
accounts.

So the split is:

| Concern | Lives in |
|---|---|
| "Given this profile, what may this person do?" | `ecosystem-core/auth` (dependency-free) |
| "Who is making this request?" | **this package** |

The payoff is that `resolveRole`, `hasPremiumAccess` and `hasPermission` never
change when the identity engine does. This package only has to produce a
`loadUser()`.

## The opt-in is at install time, not runtime

A runtime flag cannot keep a dependency out. If any reachable code path imports
the package, Vite and SvelteKit resolve it at build time — so a surface that
"disabled auth" at runtime would still carry it in `node_modules` and in the
bundle.

The actual opt-in is therefore a **generated file**:

```bash
node scripts/scaffold.mjs --surface ../technical-authority-website --dry-run
node scripts/scaffold.mjs --surface ../technical-authority-website
```

That writes exactly one file into the surface,
`src/lib/server/auth-provider.ts`, which is the only thing that imports this
package. Deleting it is the whole opt-out. Swapping identity providers later
means swapping that one file.

Options: `--schema <name>` (default `auth`), `--driver <pg|postgres>` (default
`pg`), `--dry-run`, `--force`. It refuses to overwrite a file it did not
generate, and it will not touch `hooks.server.ts` — it prints the snippet.

## Usage

```ts
import { createAuthAdapter } from '@ishan/ecosystem-auth';

const adapter = createAuthAdapter({
  database: {
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 }),
    }),
    type: 'postgres',
    schemaName: 'auth',
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: 'https://example.com',
});

// Satisfies core's port. Role/tier rules stay in the core.
const session = adapter.createSessionService({
  headers: event.request.headers,
  loadProfile: (id) => postgrest.selectOne('profiles', { id }),
  premiumTiers: ['sovereign'],
});

const user = await session.requireUser();
```

`createSessionService` and `createSessionPorts` take an optional preloaded
`session`, so a request that already resolved one does not pay for a second
validation — core's port contract explicitly warns against that.

Nothing here throws for a request-level failure. An unreachable database, or a
session lookup that fails, resolves to `null` — the same stance core's
`getSession` takes. A route guards on a null session instead of wrapping itself
in a `try/catch`.

## The one thing that will bite you

**`database` must not be a connection string.** Better Auth 1.7.x inspects its
argument with `'db' in database`, which throws on a string:

```
TypeError: Cannot use 'in' operator to search for 'db' in postgres://…
```

That escapes from an internal `init()` call as an **unhandled rejection the
caller cannot catch** — it is not a rejected promise from `getSession`. A great
many examples and blog posts show the string form, so this is the first thing
that fails.

`validateAuthConfig` rejects a string at construction with a message naming the
fix, which turns a mid-request mystery into a deploy-time error. Supported
shapes:

| Shape | `schemaName` |
|---|---|
| `{ dialect, type: 'postgres', schemaName }` | ✅ preferred |
| `{ db, type: 'postgres', schemaName }` | ✅ |
| a `pg` Pool | ❌ (`public`) |
| a Kysely dialect instance | ❌ (`public`) |

## Why `schemaName: 'auth'` matters

PostgREST exposes the `public` schema. Put the identity tables anywhere else and
they are not reachable over the REST API at all — no policy to write, no table
to accidentally expose. This is a security property, not tidiness.

Note that the whole ecosystem bypasses Supabase RLS anyway (it talks to PostgREST
with the service-role key), so authorization lives in application code. Nothing
here changes that.

## Workers and Hyperdrive

Three things must be true on Cloudflare, and only the first is obvious:

1. **`nodejs_compat` in `wrangler.toml`.** Better Auth's password hashing uses
   native `node:crypto` scrypt. Without the flag it falls back to a pure-JS
   implementation that intermittently exceeds the Workers CPU budget on sign-up
   ([#8860](https://github.com/better-auth/better-auth/issues/8860)). The fix
   ([#8685](https://github.com/better-auth/better-auth/pull/8685)) landed in
   `@better-auth/utils@0.4.0`; the pinned `better-auth@^1.7.5` carries `0.4.2`,
   so it is already in the released line.
2. **A connection path.** A Worker may open only **six** outbound connections per
   invocation and its isolate is short-lived, so there is no process-wide pool.
   Cloudflare Hyperdrive is the supported answer; Supabase's own Supavisor pooler
   is the no-new-infrastructure fallback.
3. **For auth queries, use a cache-disabled Hyperdrive config.** Hyperdrive's
   query cache does **not** invalidate on write (default `max_age` 60s). Cloudflare
   documents two configs per database for exactly this reason: one cached for
   content, one `--caching-disabled` for authentication, sessions and permissions.
   A 60-second-stale session read is a security bug.

If the driver is postgres.js rather than `pg`, set `prepare: false` — Supabase's
pooler runs in transaction mode, where server-side prepared statements are
unavailable.

For latency, enable **Smart Placement**: the database lives in one region while
Workers run from everywhere, and Better Auth issues several sequential queries
per request.

Session reads can be taken off the database entirely with Better Auth's own
`cookieCache` and `secondaryStorage`. That is deliberately **not** wrapped here —
those features carry invalidation semantics this package would only reimplement
badly. Verify revocation behaviour before relying on either.

## What is deliberately not here

- **No SvelteKit types.** `better-auth/svelte-kit` is not imported. Wrapping
  `svelteKitHandler` would pull `RequestEvent` into a package the CMS and any
  plain Worker also consume. The hook is five lines and lives in the surface;
  the scaffolder prints it. The contract script enforces this.
- **No Supabase Auth.** The engine there is a managed service, not our code, and
  the rest is `RequestEvent` handling.
- **No session caching**, for the reason above.
- **No payment plugins.** `@better-auth/stripe` is Stripe-only, and our payments
  are Razorpay — already hardened in `ecosystem-core/./payments`. A tier bridge
  belongs there, not here.

## Commands

```bash
npm run contract    # enforce the injection contract
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsc → dist/
npm run verify      # all of the above
npm run scaffold -- --surface ../some-site --dry-run
```
