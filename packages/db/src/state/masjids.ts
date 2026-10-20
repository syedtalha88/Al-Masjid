// Masjid state functions (02 §3, PHASE_01 T1.3/T1.11): the ONLY way to create a masjid or change its status. Each
// asserts the Super Admin scope (★ actions need a fresh step-up), runs in one transaction, applies the visibility
// mirror (02 §5), bumps the content version and writes the audit entry.
import { Long, type UUID } from 'mongodb';

import { type DbHandle, type TxContext, withTransaction } from '../client.ts';
import { bumpMasjidVersion, StateError, withFollowCode, writeAudit } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { newId } from '../values.ts';
import { requireSuper } from './guards.ts';

export interface NewMasjid {
  readonly name: string;
  readonly nameI18n?: { readonly hi?: string; readonly ur?: string; readonly te?: string };
  readonly area: string;
  readonly city: string;
  readonly state: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly calcMethod?: 'karachi' | 'mwl' | 'isna' | 'egypt' | 'umm_al_qura' | 'other_custom';
  readonly asrMadhab?: 'hanafi' | 'shafi';
  readonly hijriOffset?: -2 | -1 | 0 | 1 | 2;
}

/** A document with a UUID id (the driver's default schema types `_id` as ObjectId). */
type IdDoc = { _id: UUID } & Record<string, unknown>;

/** Child collections carrying `masjid_id` + `masjid_visible` (02 §5 visibility mirror). */
const MIRRORED = ['special_timings', 'items', 'chanda_weeks', 'payment_profiles'] as const;

/** Sets `masjid_visible` on every child document of a masjid (02 §5), in the caller's transaction. */
export async function mirrorVisibility(ctx: TxContext, masjidId: UUID, visible: boolean): Promise<void> {
  const session = { session: ctx.session };
  await ctx.db
    .collection<{ _id: UUID }>('masjid_timings')
    .updateOne({ _id: masjidId }, { $set: { masjid_visible: visible } }, session);
  for (const name of MIRRORED) {
    await ctx.db
      .collection<{ masjid_id: UUID }>(name)
      .updateMany({ masjid_id: masjidId }, { $set: { masjid_visible: visible } }, session);
  }
}

/** Coordinates rounded to 6 decimals (02 §2 masjids). */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Creates a pending masjid with a unique follow code and its stats document (Super Admin).
 *
 * @returns the new id and follow code.
 * @throws StateError FORBIDDEN, FOLLOW_CODE_EXHAUSTED; a MongoDB validation error for values 02 forbids.
 */
export async function createMasjid(
  handle: DbHandle,
  scope: Scope,
  input: NewMasjid,
  options: { random?: (bytes: number) => Buffer; requestId?: string } = {},
): Promise<{ id: UUID; followCode: string }> {
  requireSuper(scope);
  // A duplicate follow code aborts the transaction, so the retry wraps the whole transaction (02 §3).
  return withFollowCode(
    (followCode) =>
      withTransaction(handle, scope, async (ctx) => {
        const now = new Date();
        const settings = await ctx.db
          .collection<{ _id: string; default_push_quota?: number }>('app_settings')
          .findOne({ _id: 'global' }, { session: ctx.session });
        const id = newId();
        await ctx.db.collection<IdDoc>('masjids').insertOne(
          {
            _id: id,
            follow_code: followCode,
            name: input.name,
            name_i18n: { ...input.nameI18n },
            area: input.area,
            city: input.city,
            state: input.state,
            address: input.address,
            lat: round6(input.lat),
            lng: round6(input.lng),
            status: 'pending',
            calc_method: input.calcMethod ?? 'karachi',
            asr_madhab: input.asrMadhab ?? 'hanafi',
            ...(input.hijriOffset === undefined ? {} : { hijri_offset: input.hijriOffset }),
            show_chanda: false,
            chanda_week_start: 5,
            sehri_precaution_min: 0,
            iftar_precaution_min: 0,
            push_daily_quota: settings?.default_push_quota ?? 8,
            content_version: Long.fromNumber(1),
            admin_count: 0,
            created_at: now,
            updated_at: now,
          },
          { session: ctx.session },
        );
        // No masjid_stats document here: mc_admin may only read it (02 §4.3). The first follow creates it (upsert by
        // mc_public) and every reader treats a missing one as zero.
        await writeAudit(ctx, {
          action: 'masjid.create',
          masjidId: id,
          targetType: 'masjid',
          targetId: id.toHexString(),
          meta: { name: input.name, city: input.city },
          ...(options.requestId ? { requestId: options.requestId } : {}),
        });
        return { id, followCode };
      }),
    options.random,
  );
}

export type MasjidTransition = 'activate' | 'suspend' | 'unsuspend' | 'delete';
const TRANSITIONS: Readonly<
  Record<MasjidTransition, { from: readonly string[]; to: string; stepUp: boolean; visible: boolean }>
> = {
  activate: { from: ['pending'], to: 'active', stepUp: false, visible: true },
  suspend: { from: ['active'], to: 'suspended', stepUp: true, visible: false },
  unsuspend: { from: ['suspended'], to: 'active', stepUp: true, visible: true },
  delete: { from: ['pending', 'active', 'suspended'], to: 'deleted', stepUp: true, visible: false },
};

/**
 * Changes a masjid's status (Super Admin; suspend/unsuspend/delete are ★ and need a fresh step-up). Activation needs at
 * least one ACTIVE admin of the masjid who accepted the current undertaking version (00 §3.1, PHASE_01 T1.11).
 *
 * @throws StateError FORBIDDEN, STEP_UP_REQUIRED, MASJID_NOT_FOUND, INVALID_TRANSITION, ACTIVATION_REQUIREMENTS.
 */
export async function changeMasjidStatus(
  handle: DbHandle,
  scope: Scope,
  input: { masjidId: UUID; transition: MasjidTransition; reason?: string; requestId?: string; now?: Date },
): Promise<void> {
  const rule = TRANSITIONS[input.transition];
  requireSuper(scope, { stepUp: rule.stepUp, ...(input.now ? { now: input.now } : {}) });
  await withTransaction(handle, scope, async (ctx) => {
    const session = { session: ctx.session };
    const masjids = ctx.db.collection<{ _id: UUID; status: string }>('masjids');
    const current = await masjids.findOne({ _id: input.masjidId }, session);
    if (!current) throw new StateError('MASJID_NOT_FOUND');
    if (!rule.from.includes(current.status)) throw new StateError('INVALID_TRANSITION');
    if (input.transition === 'activate') await assertActivatable(ctx, input.masjidId);
    const now = new Date();
    const result = await masjids.updateOne(
      { _id: input.masjidId, status: current.status },
      {
        $set: {
          status: rule.to,
          updated_at: now,
          ...(input.transition === 'activate' ? { verified_at: now } : {}),
          ...(input.transition === 'delete' ? { deleted_at: now } : {}),
        },
      },
      session,
    );
    if (result.matchedCount !== 1) throw new StateError('INVALID_TRANSITION');
    await mirrorVisibility(ctx, input.masjidId, rule.visible);
    await bumpMasjidVersion(ctx, input.masjidId);
    await writeAudit(ctx, {
      action: `masjid.${input.transition}`,
      masjidId: input.masjidId,
      targetType: 'masjid',
      targetId: input.masjidId.toHexString(),
      ...(input.reason ? { meta: { reason: input.reason.slice(0, 300) } } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

async function assertActivatable(ctx: TxContext, masjidId: UUID): Promise<void> {
  const session = { session: ctx.session };
  const settings = await ctx.db
    .collection<{ _id: string; undertaking_version?: string }>('app_settings')
    .findOne({ _id: 'global' }, session);
  const members = await ctx.db
    .collection<{ masjid_id: UUID; admin_id: UUID }>('masjid_admins')
    .find({ masjid_id: masjidId }, { ...session, projection: { admin_id: 1 } })
    .toArray();
  const ready = await ctx.db
    .collection<{ _id: UUID; status: string; undertaking_version?: string }>('admin_users')
    .countDocuments(
      {
        _id: { $in: members.map((m) => m.admin_id) },
        status: 'active',
        undertaking_version: settings?.undertaking_version ?? '',
      },
      session,
    );
  if (ready === 0) throw new StateError('ACTIVATION_REQUIREMENTS');
}
