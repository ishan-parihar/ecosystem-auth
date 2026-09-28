/**
 * Session mapping.
 *
 * The join between Better Auth and the rest of the ecosystem. Better Auth hands
 * back `{ session, user }` with a user shape it owns; `@ishan/ecosystem-core`
 * wants a `SessionUser` with a guaranteed string `id`. Mapping is kept as pure
 * functions, separate from the factory that talks to Better Auth, so the rules
 * that decide "is this a usable identity?" are testable without a database.
 *
 * Both mappers return `null` rather than throwing. An unusable session is an
 * unauthenticated request - the same stance core's `getSession` takes - and a
 * route handler should never have to catch an exception to find that out.
 */

import type { SessionUser } from '@ishan/ecosystem-core/auth';

/** Better Auth's session payload, narrowed to what we read. */
export interface ProviderSession<S = Record<string, unknown>> {
	user: SessionUser;
	session: S;
}

/**
 * Normalise Better Auth's user into core's `SessionUser`.
 *
 * Everything is preserved - surfaces read extra columns such as `name`,
 * `emailVerified` or plugin-added fields - but `id` is validated, because it is
 * the one field every downstream lookup keys on. A user with no usable id is
 * rejected here rather than producing a session that resolves to nothing.
 */
export function toSessionUser(user: unknown): SessionUser | null {
	if (typeof user !== 'object' || user === null) return null;

	const record = user as Record<string, unknown>;
	const id = record.id;
	if (typeof id !== 'string' || id.trim().length === 0) return null;

	const email = record.email;

	return {
		...record,
		id,
		email: typeof email === 'string' ? email : email === null ? null : undefined,
	};
}

/**
 * Map a raw Better Auth `getSession` result.
 *
 * Returns `null` unless *both* halves are present. A user without a session, or
 * a session without a user, is not a partial login to be repaired - it is
 * invalid.
 */
export function toProviderSession<S = Record<string, unknown>>(
	raw: unknown,
): ProviderSession<S> | null {
	if (typeof raw !== 'object' || raw === null) return null;

	const record = raw as Record<string, unknown>;
	const user = toSessionUser(record.user);
	if (!user) return null;

	const session = record.session;
	if (typeof session !== 'object' || session === null) return null;

	return { user, session: session as S };
}
