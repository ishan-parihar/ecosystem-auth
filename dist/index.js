/**
 * @ishan/ecosystem-auth
 *
 * The optional identity sidecar. It is a separate package from
 * `@ishan/ecosystem-core` on purpose: Better Auth, Kysely and a Postgres driver
 * are a real payload, and core's contract is that it stays dependency-free and
 * runs anywhere. A surface that has no accounts never installs this.
 *
 * What it is for: satisfying core's `SessionPorts` port with a Better Auth
 * session, so `resolveRole`, `hasPremiumAccess` and `hasPermission` keep working
 * unchanged no matter which identity engine is behind them.
 *
 *   const adapter = createAuthAdapter({
 *     database: {
 *       dialect: new PostgresDialect({ pool: new Pool({ connectionString: env.HYPERDRIVE.connectionString }) }),
 *       type: 'postgres',
 *       schemaName: 'auth',
 *     },
 *     secret: env.BETTER_AUTH_SECRET,
 *     baseURL: 'https://example.com',
 *   });
 *
 *   const session = adapter.createSessionService({
 *     headers: event.request.headers,
 *     loadProfile: (id) => postgrest.selectOne('profiles', { id }),
 *   });
 *
 *   const user = await session.requireUser();
 *
 * Note the `database` object: a bare connection string is *not* accepted by
 * Better Auth 1.7.x, and the `{ dialect }` form is the only one that carries
 * `schemaName`. Read `README.md` for the Workers and Hyperdrive specifics, and
 * `scripts/scaffold.mjs` for the install-time opt-in.
 */
export { AuthConfigError, KV_MIN_TTL_SECONDS, WORKERS_REQUIREMENTS, validateAuthConfig, } from './config.js';
export { toProviderSession, toSessionUser, } from './session.js';
export { createAuthAdapter, } from './adapter.js';
//# sourceMappingURL=index.js.map