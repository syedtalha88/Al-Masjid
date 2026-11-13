// Needy people for the masjid's admins (03 §4 "Needy people", 07 B19, DECISIONS #104, PHASE_05 T5.8): list, add,
// replace, "Update received", close, delete, and the private phone / note. Every save carries `consentConfirmed: true`
// (05 §1). The private part is encrypted here with the field key (AES-256-GCM, context `beneficiaries.private_enc`)
// before it reaches the data layer and decrypted only for an admin of the same masjid — each view is audited. The
// repositories re-resolve the masjid under the session's scope, so another masjid answers like an unknown one.
// Every change purges the masjid's CDN tag at once (F67, #180 M7) — the public list is otherwise cached for a day.
import { randomUUID } from 'node:crypto';

import { type DbHandle, idText, parseId } from '@mc/db';
import { listBeneficiariesForAdmin } from '@mc/db/repos';
import {
  type BeneficiaryInput,
  createBeneficiary,
  endBeneficiary,
  readBeneficiaryPrivate,
  setBeneficiaryReceived,
  updateBeneficiary,
} from '@mc/db/state';
import {
  adminBeneficiaryListSchema,
  type BeneficiaryPrivate,
  beneficiaryPrivateResultSchema,
  beneficiaryPrivateSchema,
  beneficiaryReceivedResultSchema,
  beneficiaryReceivedSchema,
  type BeneficiarySave,
  beneficiarySavedSchema,
  beneficiarySaveSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { decryptField, encryptField, type FieldKeyRing } from '../crypto/field.ts';
import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import type { CdnPurgeService } from '../queue/cdn.ts';

export interface BeneficiaryRouteDeps {
  readonly db: DbHandle;
  readonly keyRing: FieldKeyRing;
  /** CDN purge (worker job); absent in unit tests — the one-day cache is then the only bound. */
  readonly cdn?: CdnPurgeService | undefined;
}

/** Associated data of the ciphertext: a value copied into another field or collection does not decrypt. */
const PRIVATE_CONTEXT = 'beneficiaries.private_enc';

const Params = z.object({ masjidId: z.string().max(64) });
const PersonParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

/** A person's id from the path; a malformed one answers like an unknown person. */
function personIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'BENEFICIARY_NOT_FOUND');
  return id;
}

const personOf = (body: BeneficiarySave): BeneficiaryInput => ({
  displayName: body.displayName,
  category: body.category,
  reason: body.reason,
  reasonLocale: body.reasonLocale,
  vpa: body.vpa,
  payeeName: body.payeeName,
  capPaise: body.capPaise,
  zakatEligible: body.zakatEligible,
  consentConfirmed: body.consentConfirmed,
});

/** The ciphertext of a private part that says something; `null` for an empty one (nothing to keep). */
function encryptPrivate(ring: FieldKeyRing, value: BeneficiaryPrivate): string | null {
  if (value.phone === undefined && value.note === undefined) return null;
  return encryptField(ring, JSON.stringify(value), PRIVATE_CONTEXT);
}

export function adminBeneficiaryRoutes(deps: BeneficiaryRouteDeps): RouteDefinition[] {
  const { db, keyRing } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  /** The public needy list changed: purge `m-<masjidId>` (never throws; a failed enqueue leaves the one-day cache). */
  const purge = async (masjidId: ReturnType<typeof masjidIdOf>) => {
    const id = idText(masjidId);
    // A fresh key per change: two changes in one millisecond must not collapse into one (already finished) purge.
    await deps.cdn?.purgeTags([`m-${id}`], `needy.${id}.${randomUUID()}`);
  };
  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/beneficiaries',
      summary: 'Needy people: active (least-funded first), then fulfilled, then closed — never the private part (B19)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminBeneficiaryListSchema },
      handler: async ({ auth, params, reply }) => {
        const { people } = await listBeneficiariesForAdmin(db, auth.scope, masjidIdOf(params.masjidId));
        // Deleted people are not listed (the repository leaves them out); the contract knows three statuses.
        return reply(200, {
          people: people.flatMap((person) =>
            person.status === 'deleted' ? [] : [{ ...person, status: person.status }],
          ),
        });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/beneficiaries',
      summary: 'Add a needy person — only with `consentConfirmed: true` (≤ 100 active); the UPI details are audited',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: beneficiarySaveSchema },
      responses: { 201: beneficiarySavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const privateEnc = body.private ? encryptPrivate(keyRing, body.private) : null;
        const created = await createBeneficiary(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          person: personOf(body),
          ...(privateEnc === null ? {} : { privateEnc }),
          now: clock.now(),
          requestId,
        });
        await purge(masjidIdOf(params.masjidId));
        return reply(201, { ...created, status: 'active' as const });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/beneficiaries/:id',
      summary:
        'Replace a listed person’s details (consent confirmed again; a UPI change is audited old → new; `private`: object = replace, null = remove, absent = keep)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: PersonParams, body: beneficiarySaveSchema },
      responses: { 200: beneficiarySavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const privateEnc =
          body.private === undefined ? undefined : body.private && encryptPrivate(keyRing, body.private);
        const { status } = await updateBeneficiary(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: personIdOf(params.id),
          person: personOf(body),
          privateEnc,
          now: clock.now(),
          requestId,
        });
        await purge(masjidIdOf(params.masjidId));
        return reply(200, { id: params.id.toLowerCase(), status: status === 'fulfilled' ? 'fulfilled' : 'active' });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/beneficiaries/:id/received',
      summary: 'Update what the person has received (history row; reaching the cap fulfils and hides them)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: PersonParams, body: beneficiaryReceivedSchema },
      responses: { 200: beneficiaryReceivedResultSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const result = await setBeneficiaryReceived(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: personIdOf(params.id),
          receivedPaise: body.receivedPaise,
          now: clock.now(),
          requestId,
        });
        await purge(masjidIdOf(params.masjidId));
        return reply(200, {
          status: result.status === 'fulfilled' ? 'fulfilled' : 'active',
          fundedPermille: result.fundedPermille,
        });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/beneficiaries/:id/close',
      summary: 'Close a person — help is no longer needed (final; data purged 90 days later)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: PersonParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await endBeneficiary(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: personIdOf(params.id),
          as: 'closed',
          now: clock.now(),
          requestId,
        });
        await purge(masjidIdOf(params.masjidId));
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/beneficiaries/:id',
      summary: 'Remove a person — a mistake, or they asked to be removed (final; data purged 90 days later)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: PersonParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await endBeneficiary(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: personIdOf(params.id),
          as: 'deleted',
          now: clock.now(),
          requestId,
        });
        await purge(masjidIdOf(params.masjidId));
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/beneficiaries/:id/private',
      summary: 'The person’s private phone / note, decrypted for an admin of this masjid (each view is audited)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: PersonParams },
      responses: { 200: beneficiaryPrivateResultSchema },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        const encrypted = await readBeneficiaryPrivate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: personIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        if (encrypted === null) return reply(200, { private: null });
        // Our own ciphertext, but still parsed: nothing unexpected is sent on.
        const parsed = beneficiaryPrivateSchema.parse(JSON.parse(decryptField(keyRing, encrypted, PRIVATE_CONTEXT)));
        return reply(200, { private: parsed });
      },
    }),
  ];
}
