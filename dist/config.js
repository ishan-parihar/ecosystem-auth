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
/**
 * Workers KV's minimum `expirationTtl`, in seconds. A rate-limit window shorter
 * than this cannot be stored in KV at all.
 */
export const KV_MIN_TTL_SECONDS = 60;
/**
 * What a Workers deployment must satisfy for this package to work at all.
 *
 * Exported as data so a surface can surface it in its own preflight rather than
 * rediscovering each item from a runtime failure. The scaffolder prints the same
 * list; this is the programmatic form.
 */
export const WORKERS_REQUIREMENTS = [
    'wrangler compatibility_flags must include "nodejs_compat". Without it Better Auth hashes passwords with a pure-JS scrypt that intermittently exceeds the Workers CPU budget on sign-up (better-auth#8860).',
    'Reach Postgres through a connection path that pools. A Worker may open only six outbound connections per invocation, and its isolate is short-lived, so there is no process-wide pool.',
    'With secondaryStorageKind "kv", every rate-limit window must be at least 60 seconds - Workers KV rejects a lower expirationTtl (better-auth#7124).',
    'For auth reads, use a Hyperdrive config created with --caching-disabled. Hyperdrive does not invalidate its query cache on write, so a cached session read can be stale.',
];
/** Raised at construction for a misconfiguration, which is a deploy fault, not a request fault. */
export class AuthConfigError extends Error {
    problems;
    constructor(problems) {
        super(`@ishan/ecosystem-auth: invalid configuration\n${problems
            .map((problem) => `  - ${problem}`)
            .join('\n')}`);
        this.name = 'AuthConfigError';
        this.problems = problems;
    }
}
function isAbsoluteUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    }
    catch {
        return false;
    }
}
/**
 * Whether `database` is a shape Better Auth's Kysely adapter actually accepts.
 *
 * Checked here rather than left to Better Auth because its failure mode is a
 * bare `TypeError: Cannot use 'in' operator` escaping as an *unhandled
 * rejection* during the first request - not an error a caller can catch, and
 * not one that names the real problem. A connection string is the natural thing
 * to pass and is not supported, so it gets its own message.
 */
function describeDatabaseShape(database) {
    if (typeof database === 'string')
        return 'string';
    if (typeof database !== 'object' || database === null)
        return 'invalid';
    const candidate = database;
    const known = ['db', 'dialect', 'createDriver', 'connect', 'getConnection', 'aggregate', 'fileControl'];
    return known.some((key) => key in candidate) ? 'ok' : 'invalid';
}
/**
 * Collect every problem with a config, rather than throwing on the first.
 *
 * A deploy that fails should tell the operator everything that is wrong in one
 * pass, because each fix costs a round trip.
 */
/** Rate-limit windows, flattened out of Better Auth's config for validation. */
function rateLimitWindows(rateLimit) {
    if (typeof rateLimit !== 'object' || rateLimit === null)
        return [];
    const record = rateLimit;
    const windows = [];
    if (typeof record.window === 'number')
        windows.push({ where: 'rateLimit.window', window: record.window });
    const custom = record.customRules;
    if (typeof custom === 'object' && custom !== null) {
        for (const [name, rule] of Object.entries(custom)) {
            if (typeof rule !== 'object' || rule === null)
                continue;
            const ruleWindow = rule.window;
            if (typeof ruleWindow === 'number') {
                windows.push({ where: `rateLimit.customRules.${name}.window`, window: ruleWindow });
            }
        }
    }
    return windows;
}
export function validateAuthConfig(config) {
    const problems = [];
    const databaseShape = describeDatabaseShape(config.database);
    if (config.database === undefined || config.database === null) {
        problems.push('database is required');
    }
    else if (databaseShape === 'string') {
        problems.push('database must not be a connection string - Better Auth 1.7.x rejects it at request time. ' +
            "Wrap the driver instead, e.g. { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'auth' }");
    }
    else if (databaseShape === 'invalid') {
        problems.push('database must be a pg/postgres.js pool, a Kysely dialect, or { db } / { dialect } with a `type`');
    }
    const secret = config.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
        problems.push('secret is required');
    }
    else if (secret.length < 32) {
        problems.push(`secret is too short (${secret.length} chars, expected 32 or more)`);
    }
    const baseURL = config.baseURL;
    if (typeof baseURL !== 'string' || baseURL.length === 0) {
        problems.push('baseURL is required');
    }
    else if (!isAbsoluteUrl(baseURL)) {
        problems.push(`baseURL must be an absolute http(s) URL, received ${JSON.stringify(baseURL)}`);
    }
    for (const origin of config.trustedOrigins ?? []) {
        if (!isAbsoluteUrl(origin)) {
            problems.push(`trustedOrigins entry must be an absolute http(s) URL: ${JSON.stringify(origin)}`);
        }
    }
    if (config.baseURL && isAbsoluteUrl(config.baseURL) && config.baseURL.endsWith('/')) {
        problems.push('baseURL must not have a trailing slash');
    }
    // Workers KV's expirationTtl floor. Better Auth defaults the rate-limit window
    // to 10 seconds, which KV cannot store, so the failure lands at request time
    // as a `kv ttl error` rather than at boot. Catch it here instead.
    if (config.secondaryStorageKind === 'kv') {
        for (const { where, window } of rateLimitWindows(config.rateLimit)) {
            if (window < KV_MIN_TTL_SECONDS) {
                problems.push(`${where} is ${window}s, but Workers KV rejects any TTL below ${KV_MIN_TTL_SECONDS}s ` +
                    '(better-auth#7124). Raise it to 60 or more, or move rate limiting off secondary storage.');
            }
        }
    }
    return problems;
}
//# sourceMappingURL=config.js.map