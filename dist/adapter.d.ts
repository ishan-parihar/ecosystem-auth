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
import type { Logger } from '@ishan/ecosystem-core';
import { type ProfileLike, type SessionPorts, type SessionService, type SessionUser } from '@ishan/ecosystem-core/auth';
import { type AuthAdapterConfig } from './config.js';
export { KV_MIN_TTL_SECONDS, WORKERS_REQUIREMENTS, type SecondaryStorageKind } from './config.js';
import { type ProviderSession } from './session.js';
/** The Better Auth instance, as `betterAuth` returns it. */
export type AuthInstance = ReturnType<typeof betterAuth>;
export interface CreateSessionPortsOptions<P extends ProfileLike = ProfileLike> {
    /** The incoming request's headers. Better Auth reads its session cookie from these. */
    headers: Headers;
    /** Profile lookup for a user id - normally a PostgREST call, supplied by the surface. */
    loadProfile: (userId: string) => Promise<P | null>;
    /**
     * A session the caller already resolved, to avoid a second validation on the
     * same request. Pass the result of `adapter.getSession(headers)`.
     */
    session?: ProviderSession | null;
    isProfileComplete?: (profile: P) => boolean;
    enrichProfile?: (profile: P | null, user: SessionUser) => Promise<P | null>;
    logger?: Logger;
    premiumTiers?: readonly string[];
}
export interface AuthAdapter {
    /** Pass to `svelteKitHandler`, and to `createAuthClient` on the server side. */
    readonly auth: AuthInstance;
    /** The mapped session for a request, or `null`. Never throws. */
    getSession(headers: Headers): Promise<ProviderSession | null>;
    /** A `SessionPorts` for core's `createSessionService`. */
    createSessionPorts<P extends ProfileLike = ProfileLike>(options: CreateSessionPortsOptions<P>): SessionPorts<P>;
    /** The ports composed into the guard helpers, the common case. */
    createSessionService<P extends ProfileLike = ProfileLike>(options: CreateSessionPortsOptions<P>): SessionService<P>;
}
/**
 * Build the adapter.
 *
 * Throws `AuthConfigError` on a bad config. That is a deploy fault rather than a
 * request fault, and failing loudly at construction is the only way it gets
 * noticed - a silently-defaulted secret or a relative `baseURL` produces auth
 * that appears to work and does not.
 */
export declare function createAuthAdapter(config: AuthAdapterConfig): AuthAdapter;
//# sourceMappingURL=adapter.d.ts.map