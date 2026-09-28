/**
 * Config.
 *
 * The shape `createAuthAdapter` accepts. Deliberately a plain object, never
 * read from `$env/*` or `import.meta.env`: the same contract as
 * `@ishan/ecosystem-core`, and for the same reason. Cloudflare bindings live on
 * `platform.env` and differ between requests, so configuration is passed in by
 * the caller that holds the binding.
 *
 * `database` is intentionally Better Auth's own type rather than ours. It
 * accepts a connection string, a `pg`/postgres.js pool, or a Kysely instance,
 * and the choice between those belongs to the surface - Hyperdrive on Workers,
 * a direct connection in a script. Re-declaring it here would only go stale.
 */
import type { BetterAuthOptions } from 'better-auth';
/** Everything a surface may hand us. `options` is the escape hatch for the rest. */
/**
 * Where Better Auth keeps sessions, verification records and rate-limit counters.
 *
 * Declared explicitly rather than sniffed, because the KV case carries a hard
 * constraint that cannot be discovered from a `secondaryStorage` object: Workers
 * KV rejects any `expirationTtl` below 60 seconds, while Better Auth defaults its
 * rate-limit window to 10 (better-auth#7124). The result is a `kv ttl error` at
 * request time, not at boot.
 */
export type SecondaryStorageKind = 'none' | 'kv' | 'redis' | 'other';
/**
 * Workers KV's minimum `expirationTtl`, in seconds. A rate-limit window shorter
 * than this cannot be stored in KV at all.
 */
export declare const KV_MIN_TTL_SECONDS = 60;
/**
 * What a Workers deployment must satisfy for this package to work at all.
 *
 * Exported as data so a surface can surface it in its own preflight rather than
 * rediscovering each item from a runtime failure. The scaffolder prints the same
 * list; this is the programmatic form.
 */
export declare const WORKERS_REQUIREMENTS: readonly string[];
export interface AuthAdapterConfig {
    /**
     * Where the identity tables live.
     *
     * A **connection string is not accepted** - Better Auth 1.7.x tests its
     * argument with `'db' in database`, which throws on a string. Pass one of:
     *
     *   - `{ dialect, type: 'postgres', schemaName: 'auth' }` - preferred, and the
     *     only form that carries `schemaName`
     *   - `{ db: kyselyInstance, type: 'postgres', schemaName: 'auth' }`
     *   - a `pg` Pool (or a Kysely `PostgresDialect` wrapping one) for the default
     *     `public` schema
     *
     * Prefer a dedicated `schemaName` such as `auth`: it keeps the identity tables
     * out of `public`, and PostgREST only exposes `public`, so they are never
     * reachable over the REST API.
     */
    database: BetterAuthOptions['database'];
    /** Signing secret for sessions and tokens. Treat as a credential: 32+ chars. */
    secret: string;
    /** Absolute origin this instance is served from, e.g. `https://example.com`. */
    baseURL: string;
    /** Product name shown in auth emails. */
    appName?: string;
    /** Extra origins allowed to post credentials, beyond `baseURL`. */
    trustedOrigins?: readonly string[];
    /** Enable email + password. Off unless a surface asks for it. */
    emailAndPassword?: boolean | BetterAuthOptions['emailAndPassword'];
    socialProviders?: BetterAuthOptions['socialProviders'];
    plugins?: BetterAuthOptions['plugins'];
    session?: BetterAuthOptions['session'];
    advanced?: BetterAuthOptions['advanced'];
    /**
     * Better Auth's rate limiting. If `secondaryStorageKind` is `'kv'`, every
     * window here must be at least `KV_MIN_TTL_SECONDS` and is validated at
     * construction.
     */
    rateLimit?: BetterAuthOptions['rateLimit'];
    /** Where sessions and rate-limit counters live. Enables the KV window check. */
    secondaryStorageKind?: SecondaryStorageKind;
    secondaryStorage?: BetterAuthOptions['secondaryStorage'];
    /**
     * Anything else Better Auth accepts. Merged last, so it wins. This exists so
     * a new Better Auth option never requires a release of this package.
     */
    options?: Omit<BetterAuthOptions, 'database' | 'secret' | 'baseURL'>;
}
/** Raised at construction for a misconfiguration, which is a deploy fault, not a request fault. */
export declare class AuthConfigError extends Error {
    readonly problems: readonly string[];
    constructor(problems: readonly string[]);
}
export declare function validateAuthConfig(config: Partial<AuthAdapterConfig>): string[];
//# sourceMappingURL=config.d.ts.map