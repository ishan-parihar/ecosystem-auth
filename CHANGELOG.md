# Changelog

All notable changes to `@ishan/ecosystem-auth`.

## [0.1.0] - 2026-09-24

Initial scaffold. Not yet consumed by any surface — this release exists so the
identity decision has a concrete artifact behind it, and so the first surface to
need accounts does not start from a blank file.

### Added

- `createAuthAdapter(config)` — builds a Better Auth instance from an injected
  config and exposes it as an `AuthAdapter`, with `getSession`, `createSessionPorts`
  and `createSessionService`.
- `validateAuthConfig(config)` and `AuthConfigError` — report every problem with
  a config at once, at construction.
- `toSessionUser(user)` and `toProviderSession(raw)` — pure mappers from Better
  Auth's payloads to `@ishan/ecosystem-core`'s `SessionUser`, returning `null`
  rather than throwing.
- `scripts/scaffold.mjs` — the install-time opt-in. Writes the consuming
  surface's `src/lib/server/auth-provider.ts`, the single file that imports this
  package, and prints the hook snippet. Supports `--dry-run`, `--force`,
  `--schema` and `--driver`.
- `scripts/verify-contract.mjs` — enforces the injection contract, including a
  ban on SvelteKit virtual modules and on `better-auth/svelte-kit`, so this
  package stays usable from non-SvelteKit consumers.
- 28 tests covering config validation, session mapping, the Workers KV
  constraint, and the adapter's failure behaviour.
- `WORKERS_REQUIREMENTS` - the four things a Workers deployment must satisfy,
  exported as data so a surface can run its own preflight instead of
  rediscovering each from a runtime failure.
- `rateLimit` and `secondaryStorage` on the config, plus `secondaryStorageKind`
  and `KV_MIN_TTL_SECONDS`.

### Fixed

- **A rate-limit window below Workers KV's floor is now a construction error.**
  Better Auth defaults its rate-limit window to 10 seconds, while Workers KV
  rejects any `expirationTtl` below 60 - so the failure landed at request time as
  a `kv ttl error` with nothing pointing at the cause
  ([better-auth#7124](https://github.com/better-auth/better-auth/issues/7124)).
  Declaring `secondaryStorageKind: 'kv'` now validates every window, including
  each `customRules` entry, and names the offending rule.

### Notes

Two findings from verifying against `better-auth@1.7.5` are encoded as guards
rather than left as documentation, because each one fails in a way that is hard
to diagnose:

- **A connection string is not a valid `database`.** Better Auth tests it with
  `'db' in database`, which throws `TypeError: Cannot use 'in' operator` from an
  internal `init()` call — surfacing as an *unhandled rejection* that a caller
  cannot catch. `validateAuthConfig` now rejects the string form at construction
  with a message naming the supported shapes.
- **`schemaName` requires the `{ dialect }` or `{ db }` object form.** Passing a
  bare pool silently puts the identity tables in `public`, where PostgREST
  exposes them.

`better-auth@^1.7.5` was chosen because it pins `@better-auth/utils@0.4.2`, which
carries the non-blocking native scrypt fix for the Workers CPU-limit failure
([#8860](https://github.com/better-auth/better-auth/issues/8860),
[#8685](https://github.com/better-auth/better-auth/pull/8685)). Do not pin below
that line on Workers.
