# AGENTS.md - `@ishan/ecosystem-auth`

Operational manual for humans and AI agents maintaining this package. Read before editing.
This is the **optional identity sidecar** for the Ishan Parihar ecosystem: a Better Auth
instance built from an injected config, plus an adapter that satisfies
`@ishan/ecosystem-core`'s `SessionPorts` port, so role/tier/permission rules stay in the
dependency-free core. It is the one package in the ecosystem that *is* allowed to be heavy
(Better Auth, Kysely, a Postgres driver) and the one most surfaces will never install.

---

## 1. What this package is

- `createAuthAdapter(config)` builds a Better Auth instance from a validated config and
  exposes `createSessionPorts()`, which returns exactly the `SessionPorts` interface
  (`loadUser` / `loadProfile` / `enrichProfile`) that `@ishan/ecosystem-core` consumes. That
  is the whole seam: identity lives here, policy lives in the core, and swapping providers
  later means swapping this adapter and nothing else in a surface.
- It is **install-time opt-in on purpose.** A runtime flag cannot exclude it, because Vite
  and SvelteKit resolve imports at build time - a surface that "disabled" auth at runtime
  would still carry the dependency in its bundle. So the choice is made by whether the
  package is installed, and `scripts/scaffold.mjs` writes the single seam file
  (`src/lib/server/auth-provider.ts`) that imports it.

## 2. The config-validation contract (this package's real invariant)

`validateAuthConfig` (`src/config.ts`) is the heart of the package and the thing the tests
actually pin. It collects **every** problem and throws an `AuthConfigError` at
construction, not at request time. That stance is deliberate: a deploy fault must be
loud and immediate, because a silently-defaulted secret or a relative `baseURL` produces
auth that appears to work and does not.

Do not weaken these rejections without a matching test change and a changelog entry:

- **A raw connection string is rejected.** Better Auth 1.7.x tests its argument with
  `'db' in database`, which throws on a string. Accept `{ dialect, type: 'postgres',
  schemaName }`, a Kysely instance, or a `pg` Pool - never a URL.
- **A `secret` shorter than 32 characters is rejected** (treat it as a credential).
- **A relative `baseURL`, a trailing slash, or a non-http protocol is rejected.**
- **Every `trustedOrigins` entry is validated**, and all problems report at once.
- **The KV 60s rate-limit floor is enforced only for `kv` storage** (better-auth#7124).

The Workers requirements (`WORKERS_REQUIREMENTS` in `config.ts`) are documented constants,
not decoration: `nodejs_compat` for scrypt's CPU budget (better-auth#8860), a pooled
Postgres path because a Worker may open only six outbound connections, and Hyperdrive built
`--caching-disabled` because it does not invalidate its query cache on write. A test pins
that this list is present, because it is what teaches the first deploy failure.

## 3. Breaking-change discipline

This package is consumed as a dependency (`file:../ecosystem-core` style links today, a
git tag once published). Same rule as the core: **a breaking change is invisible to a
pinned consumer until they deliberately upgrade.** Therefore:

- **Additive by default; a version bump is required and deliberate.** A new optional config
  field is a minor. Removing or reshaping an export, tightening a validation that a valid
  existing config trips, or changing a default is a major.
- **A validation rule is a public contract.** Tightening a rejection is breaking even
  though no export changed - a surface with a currently-accepted config starts throwing at
  deploy. Treat a new rejection as a major, not a patch.
- **Never silently default a security-sensitive field.** `emailAndPassword` is **off unless
  a surface opts in** (`config.ts`), and that default is load-bearing: the core dropped its
  brute-force `./security` module precisely because the ecosystem is OTP-only by default. If
  you ever change this default, you have invalidated that premise and must say so loudly.
- **The removal commit, the `package.json` bump, and the changelog entry are one commit.**

## 4. The `dist/` invariant

`dist/` is committed and shipped in `files`. It must match `src/` exactly, proven by
content after a real build - never by comparing filenames:

```
npm run build && git diff --quiet -- dist
```

CI (`.github/workflows/ci.yml`) fails on any drift. `tsc` does not clean `dist/`, so a
removed module's build output must be deleted by hand or it ships as a ghost alongside an
`exports` map that no longer names it.

## 5. Test and build commands

```
npm run typecheck   # tsc --noEmit
npm run build       # tsc -p tsconfig.json (emits dist/)
npm run test        # vitest run
npm run scaffold -- --surface ../foo   # opt-in install (writes ONE seam file)
npm run verify      # typecheck + build + test
```

A change is not done until `npm run verify` is green **and** the `dist/` gate passes. New
behaviour needs a test that can fail. The existing suite deliberately exercises
`createAuthAdapter` with no reachable database (the `Could not validate the database
schema` lines in test output are expected stderr from those cases, not failures) - a test
that needs a live Postgres is a test that will not run in CI.

## 6. Relationship to the core

- `@ishan/ecosystem-core` is consumed for the `SessionPorts` / `SessionUser` /
  `ProfileLike` types and for the `resolveRole` / `hasPremiumAccess` / `hasPermission`
  rules. It is the dependency-free side; this package is the identity side.
- This package must not re-implement role, tier, or permission logic. If a policy question
  arises ("is this user premium?"), it belongs in the core, and this package only supplies
  the session.
- `npm run typecheck` here is also a check that the core's `SessionPorts` contract is still
  satisfied; if the core changes that interface, this package's typecheck is what catches
  it first.
