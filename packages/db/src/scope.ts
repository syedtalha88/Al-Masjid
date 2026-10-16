// Typed scopes (01 §5.1, 02 §3–4, DECISIONS #20): WHO is acting. Built by the API from an authenticated session or
// device (after loading memberships) — never from request input. Each scope is frozen and carries a private brand,
// so a repository can tell a real scope from an object a caller assembled; the policy layer reads only the scope.
import type { UUID } from 'mongodb';

const BRAND: unique symbol = Symbol('mc.scope');

export type MasjidRole = 'owner' | 'editor';

export interface MasjidMembership {
  readonly id: UUID;
  readonly role: MasjidRole;
}

interface Branded {
  readonly [BRAND]: true;
}
export type PublicScope = Branded & { readonly kind: 'public' };
export type DeviceScope = Branded & { readonly kind: 'device'; readonly deviceId: UUID };
export type AdminScope = Branded & {
  readonly kind: 'admin';
  readonly adminId: UUID;
  readonly masjids: readonly MasjidMembership[];
};
export type SuperScope = Branded & {
  readonly kind: 'super';
  readonly adminId: UUID;
  /** Set by the API when the request carries a fresh step-up (★ actions, 04 §4). */
  readonly stepUpAt?: Date;
};
export type HookScope = Branded & { readonly kind: 'hook'; readonly name: string };
export type SystemScope = Branded & { readonly kind: 'system' };
export type Scope = PublicScope | DeviceScope | AdminScope | SuperScope | HookScope | SystemScope;

const make = <S extends Scope>(value: Omit<S, typeof BRAND>): S =>
  Object.freeze({ ...value, [BRAND]: true }) as unknown as S; // the only place a brand is attached

/** Anonymous public API (api-public). */
export const publicScope = (): PublicScope => make<PublicScope>({ kind: 'public' });

/** A registered musalli device (authenticated by its secret). */
export const deviceScope = (deviceId: UUID): DeviceScope => make<DeviceScope>({ kind: 'device', deviceId });

/**
 * A masjid admin with the memberships loaded from `masjid_admins` for an ACTIVE admin (02 §3).
 *
 * @param masjids - deduplicated by id; an empty list is allowed (the admin can read only themself).
 */
export const adminScope = (input: { adminId: UUID; masjids: readonly MasjidMembership[] }): AdminScope => {
  const seen = new Set<string>();
  const masjids = input.masjids.filter((m) => {
    const key = m.id.toHexString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return make<AdminScope>({
    kind: 'admin',
    adminId: input.adminId,
    masjids: Object.freeze(masjids.map((m) => Object.freeze({ id: m.id, role: m.role }))),
  });
};

/** The Super Admin; `stepUpAt` only when the request proved a fresh step-up. */
export const superScope = (adminId: UUID, stepUpAt?: Date): SuperScope =>
  make<SuperScope>(stepUpAt ? { kind: 'super', adminId, stepUpAt } : { kind: 'super', adminId });

/** Inbound webhooks only (packages/api/src/hooks/** — lint-enforced). No policy cells in v1 (02 §4.1). */
export const hookScope = (name: string): HookScope => make<HookScope>({ kind: 'hook', name });

/** Worker jobs and one-off scripts only (packages/api/src/jobs/**, scripts/** — lint-enforced). */
export const systemScope = (): SystemScope => make<SystemScope>({ kind: 'system' });

/** True only for scopes built by the constructors above. */
export function isScope(value: unknown): value is Scope {
  return typeof value === 'object' && value !== null && BRAND in value && Object.isFrozen(value);
}

/** The ids of the masjids an admin scope may act on (empty for every other scope). */
export function scopeMasjidIds(scope: Scope): readonly UUID[] {
  return scope.kind === 'admin' ? scope.masjids.map((m) => m.id) : [];
}
