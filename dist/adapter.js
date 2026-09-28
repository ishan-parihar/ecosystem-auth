/**
 * The adapter.
 *
 * Builds a Better Auth instance from an injected config and exposes it through
 * the one interface the rest of the ecosystem already speaks: the `SessionPorts`
 * port that `@ishan/ecosystem-core/auth` defines. That is the whole trick - the
 * role, tier and permission rules stay in the dependency-free core, and this
 * package only has to answer "who is making this request?".
 *
 * Two boundaries are deliberate:
 *
 *   - **No SvelteKit types.** `better-auth/svelte-kit` is not imported here.
 *     Wrapping `svelteKitHandler` would pull `RequestEvent` into a package that
 *     the CMS and any future Worker consumer also use. The hook is five lines
 *     and lives in the surface; `scripts/scaffold.mjs` writes it out.
 *   - **The session is read once per request.** `createSessionPorts` takes an
 *     optional preloaded session and memoises whatever it does fetch, because
 *     core's port contract notes that re-validating on every call doubles auth
 *     latency for no security gain.
 *
 * Sessions are deliberately *not* cached here. Better Auth's own `cookieCache`
 * and `secondaryStorage` are the supported levers for that, and they carry
 * invalidation semantics this package would otherwise have to reimplement.
 */
import { betterAuth } from 'better-auth';
import { createSessionService, } from '@ishan/ecosystem-core/auth';
import { AuthConfigError, validateAuthConfig } from './config.js';
export { KV_MIN_TTL_SECONDS, WORKERS_REQUIREMENTS } from './config.js';
import { toProviderSession } from './session.js';
function buildOptions(config) {
    const base = {
        database: config.database,
        secret: config.secret,
        baseURL: config.baseURL,
        appName: config.appName ?? 'Ishan Parihar',
    };
    if (config.trustedOrigins)
        base.trustedOrigins = [...config.trustedOrigins];
    if (config.socialProviders)
        base.socialProviders = config.socialProviders;
    if (config.plugins)
        base.plugins = config.plugins;
    if (config.session)
        base.session = config.session;
    if (config.advanced)
        base.advanced = config.advanced;
    if (config.rateLimit)
        base.rateLimit = config.rateLimit;
    if (config.secondaryStorage)
        base.secondaryStorage = config.secondaryStorage;
    // `emailAndPassword: true` is a shorthand for "enabled with the defaults".
    if (config.emailAndPassword === true) {
        base.emailAndPassword = { enabled: true };
    }
    else if (config.emailAndPassword) {
        base.emailAndPassword = config.emailAndPassword;
    }
    // Escape hatch last, so it always wins. `database`/`secret`/`baseURL` are
    // excluded from its type, so it cannot silently undo the validated config.
    return { ...base, ...(config.options ?? {}) };
}
/**
 * Build the adapter.
 *
 * Throws `AuthConfigError` on a bad config. That is a deploy fault rather than a
 * request fault, and failing loudly at construction is the only way it gets
 * noticed - a silently-defaulted secret or a relative `baseURL` produces auth
 * that appears to work and does not.
 */
export function createAuthAdapter(config) {
    const problems = validateAuthConfig(config);
    if (problems.length > 0)
        throw new AuthConfigError(problems);
    const auth = betterAuth(buildOptions(config));
    async function getSession(headers) {
        try {
            const raw = await auth.api.getSession({ headers });
            return toProviderSession(raw);
        }
        catch {
            // A session lookup that fails is an unauthenticated request. Returning
            // null keeps the same stance as core's `getSession`: callers guard on a
            // null session instead of wrapping every route in a try/catch.
            return null;
        }
    }
    const adapter = {
        auth,
        getSession,
        createSessionPorts(options) {
            // `undefined` means "not resolved yet"; `null` means "resolved, nobody
            // is signed in". Collapsing those would re-query on every anonymous
            // request, which is most of them.
            let resolved = options.session;
            const ports = {
                loadUser: async () => {
                    if (resolved === undefined)
                        resolved = await getSession(options.headers);
                    return resolved?.user ?? null;
                },
                loadProfile: options.loadProfile,
            };
            if (options.isProfileComplete)
                ports.isProfileComplete = options.isProfileComplete;
            if (options.enrichProfile)
                ports.enrichProfile = options.enrichProfile;
            if (options.logger)
                ports.logger = options.logger;
            if (options.premiumTiers)
                ports.premiumTiers = options.premiumTiers;
            return ports;
        },
        createSessionService(options) {
            return createSessionService(adapter.createSessionPorts(options));
        },
    };
    return adapter;
}
//# sourceMappingURL=adapter.js.map