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

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Logger } from '@ishan/ecosystem-core';
import {
	createSessionService,
	type ProfileLike,
	type SessionPorts,
	type SessionService,
	type SessionUser,
} from '@ishan/ecosystem-core/auth';

import { AuthConfigError, validateAuthConfig, type AuthAdapterConfig } from './config.js';

export { KV_MIN_TTL_SECONDS, WORKERS_REQUIREMENTS, type SecondaryStorageKind } from './config.js';
import { toProviderSession, type ProviderSession } from './session.js';

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
	createSessionPorts<P extends ProfileLike = ProfileLike>(
		options: CreateSessionPortsOptions<P>,
	): SessionPorts<P>;
	/** The ports composed into the guard helpers, the common case. */
	createSessionService<P extends ProfileLike = ProfileLike>(
		options: CreateSessionPortsOptions<P>,
	): SessionService<P>;
}

function buildOptions(config: AuthAdapterConfig): BetterAuthOptions {
	const base: BetterAuthOptions = {
		database: config.database,
		secret: config.secret,
		baseURL: config.baseURL,
		appName: config.appName ?? 'Ishan Parihar',
	};

	if (config.trustedOrigins) base.trustedOrigins = [...config.trustedOrigins];
	if (config.socialProviders) base.socialProviders = config.socialProviders;
	if (config.plugins) base.plugins = config.plugins;
	if (config.session) base.session = config.session;
	if (config.advanced) base.advanced = config.advanced;
	if (config.rateLimit) base.rateLimit = config.rateLimit;
	if (config.secondaryStorage) base.secondaryStorage = config.secondaryStorage;

	// `emailAndPassword: true` is a shorthand for "enabled with the defaults".
	if (config.emailAndPassword === true) {
		base.emailAndPassword = { enabled: true };
	} else if (config.emailAndPassword) {
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
export function createAuthAdapter(config: AuthAdapterConfig): AuthAdapter {
	const problems = validateAuthConfig(config);
	if (problems.length > 0) throw new AuthConfigError(problems);

	const auth = betterAuth(buildOptions(config));

	async function getSession(headers: Headers): Promise<ProviderSession | null> {
		try {
			const raw = await auth.api.getSession({ headers });
			return toProviderSession(raw);
		} catch {
			// A session lookup that fails is an unauthenticated request. Returning
			// null keeps the same stance as core's `getSession`: callers guard on a
			// null session instead of wrapping every route in a try/catch.
			return null;
		}
	}

	const adapter: AuthAdapter = {
		auth,
		getSession,

		createSessionPorts<P extends ProfileLike = ProfileLike>(
			options: CreateSessionPortsOptions<P>,
		): SessionPorts<P> {
			// `undefined` means "not resolved yet"; `null` means "resolved, nobody
			// is signed in". Collapsing those would re-query on every anonymous
			// request, which is most of them.
			let resolved: ProviderSession | null | undefined = options.session;

			const ports: SessionPorts<P> = {
				loadUser: async (): Promise<SessionUser | null> => {
					if (resolved === undefined) resolved = await getSession(options.headers);
					return resolved?.user ?? null;
				},
				loadProfile: options.loadProfile,
			};

			if (options.isProfileComplete) ports.isProfileComplete = options.isProfileComplete;
			if (options.enrichProfile) ports.enrichProfile = options.enrichProfile;
			if (options.logger) ports.logger = options.logger;
			if (options.premiumTiers) ports.premiumTiers = options.premiumTiers;

			return ports;
		},

		createSessionService<P extends ProfileLike = ProfileLike>(
			options: CreateSessionPortsOptions<P>,
		): SessionService<P> {
			return createSessionService<P>(adapter.createSessionPorts(options));
		},
	};

	return adapter;
}
