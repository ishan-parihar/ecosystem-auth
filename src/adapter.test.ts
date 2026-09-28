import { PostgresDialect } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { createAuthAdapter } from './adapter.js';
import {
	AuthConfigError,
	KV_MIN_TTL_SECONDS,
	WORKERS_REQUIREMENTS,
	validateAuthConfig,
	type AuthAdapterConfig,
} from './config.js';
import { toProviderSession, toSessionUser } from './session.js';

const SECRET = 'a'.repeat(48);

/**
 * A pool that fails on connect, so Kysely never reaches a real database but the
 * dialect itself is well-formed. This is the shape production uses, including
 * the `schemaName` that keeps the identity tables out of `public`.
 */
function unreachablePool(): never {
	return {
		connect: async () => {
			throw new Error('ECONNREFUSED 127.0.0.1:59999');
		},
		end: async () => undefined,
	} as never;
}

function goodConfig(): AuthAdapterConfig {
	return {
		database: {
			dialect: new PostgresDialect({ pool: unreachablePool() }),
			type: 'postgres',
			schemaName: 'auth',
		},
		secret: SECRET,
		baseURL: 'https://example.com',
	};
}

describe('validateAuthConfig', () => {
	it('accepts a minimal valid config', () => {
		expect(validateAuthConfig(goodConfig())).toEqual([]);
	});

	it('reports every problem at once rather than the first', () => {
		const problems = validateAuthConfig({});
		expect(problems).toHaveLength(3);
		expect(problems.join(' ')).toMatch(/database/);
		expect(problems.join(' ')).toMatch(/secret/);
		expect(problems.join(' ')).toMatch(/baseURL/);
	});

	it('rejects a raw connection string, which Better Auth 1.7.x cannot accept', () => {
		const problems = validateAuthConfig({
			...goodConfig(),
			// @ts-expect-error the shape a caller naturally reaches for, and the one that breaks
			database: 'postgres://user:pass@host/db',
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/must not be a connection string/);
	});

	it('accepts each database shape Better Auth actually supports', () => {
		expect(validateAuthConfig({ ...goodConfig(), database: { connect: () => {} } as never })).toEqual([]);
		expect(validateAuthConfig({ ...goodConfig(), database: { db: {}, type: 'postgres' } as never })).toEqual([]);
		expect(validateAuthConfig({ ...goodConfig(), database: { createDriver: () => {} } as never })).toEqual([]);
	});

	it('rejects a database object with no recognisable shape', () => {
		const problems = validateAuthConfig({ ...goodConfig(), database: { nope: true } as never });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/must be a pg\/postgres\.js pool/);
	});

	it('rejects a secret shorter than 32 characters', () => {
		const problems = validateAuthConfig({ ...goodConfig(), secret: 'short' });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/too short/);
	});

	it('rejects a relative baseURL', () => {
		const problems = validateAuthConfig({ ...goodConfig(), baseURL: '/auth' });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/absolute/);
	});

	it('rejects a baseURL with a trailing slash', () => {
		const problems = validateAuthConfig({ ...goodConfig(), baseURL: 'https://example.com/' });
		expect(problems.some((problem) => problem.includes('trailing slash'))).toBe(true);
	});

	it('rejects a non-http protocol', () => {
		const problems = validateAuthConfig({ ...goodConfig(), baseURL: 'ftp://example.com' });
		expect(problems.some((problem) => problem.includes('absolute'))).toBe(true);
	});

	it('validates every trustedOrigins entry', () => {
		const problems = validateAuthConfig({
			...goodConfig(),
			trustedOrigins: ['https://ok.example', 'nope'],
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/trustedOrigins/);
	});
});

describe('Workers KV constraints', () => {
	it("rejects a rate-limit window below KV's 60s floor", () => {
		const problems = validateAuthConfig({
			...goodConfig(),
			secondaryStorageKind: 'kv',
			rateLimit: { window: 10, max: 100 },
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/KV rejects any TTL below 60s/);
	});

	it('accepts a window exactly at the floor', () => {
		expect(
			validateAuthConfig({
				...goodConfig(),
				secondaryStorageKind: 'kv',
				rateLimit: { window: KV_MIN_TTL_SECONDS, max: 100 },
			}),
		).toEqual([]);
	});

	it('checks custom rule windows too, and names the offending rule', () => {
		const problems = validateAuthConfig({
			...goodConfig(),
			secondaryStorageKind: 'kv',
			rateLimit: {
				window: 60,
				max: 100,
				customRules: { '/sign-in/email': { window: 5, max: 3 } },
			} as never,
		});
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/customRules\.\/sign-in\/email\.window/);
	});

	it('does not apply the KV floor to other storage backends', () => {
		expect(
			validateAuthConfig({ ...goodConfig(), secondaryStorageKind: 'redis', rateLimit: { window: 10, max: 100 } }),
		).toEqual([]);
	});

	it('documents the Workers requirements the first failure would otherwise teach', () => {
		expect(WORKERS_REQUIREMENTS.join(' ')).toMatch(/nodejs_compat/);
		expect(WORKERS_REQUIREMENTS.join(' ')).toMatch(/caching-disabled/);
	});
});

describe('toSessionUser', () => {
	it('maps a user and preserves unknown fields', () => {
		const user = toSessionUser({ id: 'u1', email: 'a@b.co', name: 'Ada', role: 'admin' });
		expect(user).toEqual({ id: 'u1', email: 'a@b.co', name: 'Ada', role: 'admin' });
	});

	it('normalises a null email but leaves an absent one undefined', () => {
		expect(toSessionUser({ id: 'u1', email: null })?.email).toBeNull();
		expect(toSessionUser({ id: 'u1' })?.email).toBeUndefined();
	});

	it('rejects a missing, non-string or empty id', () => {
		expect(toSessionUser({ email: 'a@b.co' })).toBeNull();
		expect(toSessionUser({ id: 42 })).toBeNull();
		expect(toSessionUser({ id: '   ' })).toBeNull();
	});

	it('rejects non-objects', () => {
		expect(toSessionUser(null)).toBeNull();
		expect(toSessionUser(undefined)).toBeNull();
		expect(toSessionUser('u1')).toBeNull();
	});
});

describe('toProviderSession', () => {
	it('maps a complete payload', () => {
		const mapped = toProviderSession({
			user: { id: 'u1', email: 'a@b.co' },
			session: { id: 's1', expiresAt: '2030-01-01' },
		});
		expect(mapped?.user.id).toBe('u1');
		expect(mapped?.session).toEqual({ id: 's1', expiresAt: '2030-01-01' });
	});

	it('is null unless both halves are present', () => {
		expect(toProviderSession({ user: { id: 'u1' } })).toBeNull();
		expect(toProviderSession({ session: { id: 's1' } })).toBeNull();
		expect(toProviderSession({})).toBeNull();
		expect(toProviderSession(null)).toBeNull();
	});

	it('rejects a payload whose user has no usable id', () => {
		expect(toProviderSession({ user: { id: '' }, session: { id: 's1' } })).toBeNull();
	});
});

describe('createAuthAdapter', () => {
	it('throws AuthConfigError carrying every problem', () => {
		let caught: unknown;
		try {
			// @ts-expect-error deliberately invalid config
			createAuthAdapter({});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AuthConfigError);
		expect((caught as AuthConfigError).problems).toHaveLength(3);
	});

	it('refuses a raw connection string at construction instead of failing mid-request', () => {
		// Without this guard Better Auth throws `TypeError: Cannot use 'in' operator`
		// from an internal init call, which surfaces as an unhandled rejection the
		// caller cannot catch.
		expect(() =>
			createAuthAdapter({
				...goodConfig(),
				// @ts-expect-error deliberately the unsupported shape
				database: 'postgres://user:pass@host/db',
			}),
		).toThrow(AuthConfigError);
	});

	it('builds an instance and exposes a handler', () => {
		const adapter = createAuthAdapter(goodConfig());
		expect(typeof adapter.auth.handler).toBe('function');
	});

	it('resolves to null instead of throwing when the session lookup fails', async () => {
		const adapter = createAuthAdapter(goodConfig());
		const session = await adapter.getSession(new Headers());
		expect(session).toBeNull();
	});

	it('never throws from requireUser, and does not load a profile when nobody is signed in', async () => {
		const adapter = createAuthAdapter(goodConfig());
		const loadProfile = vi.fn(async () => null);

		const service = adapter.createSessionService({
			headers: new Headers(),
			loadProfile,
		});

		await expect(service.requireUser()).resolves.toBeNull();
		await expect(service.requireAdmin()).resolves.toBeNull();
		await expect(service.requirePremium()).resolves.toBeNull();
		await expect(service.requirePermission('anything')).resolves.toBeNull();

		// The important part: an anonymous request costs one session lookup and no
		// profile query, which is the traffic most surfaces see.
		expect(loadProfile).not.toHaveBeenCalled();
	});

	it('honours a preloaded session and skips the lookup', async () => {
		const adapter = createAuthAdapter(goodConfig());
		const getSession = vi.spyOn(adapter, 'getSession');
		const loadProfile = vi.fn(async () => ({ is_admin: true, tier: 'sovereign' }));

		const service = adapter.createSessionService({
			headers: new Headers(),
			loadProfile,
			session: { user: { id: 'u1', email: null }, session: { id: 's1' } },
		});

		const resolved = await service.requireUser();
		expect(resolved?.user.id).toBe('u1');
		expect(resolved?.role).toBe('admin');
		expect(resolved?.isAdmin).toBe(true);
		expect(resolved?.isPremium).toBe(true);
		expect(getSession).not.toHaveBeenCalled();
		expect(loadProfile).toHaveBeenCalledExactlyOnceWith('u1');
	});
});
