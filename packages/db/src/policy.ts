// The policy layer (02 §4.1, DECISIONS #20 layer 2, PHASE_01 T1.4): for every (namespace × scope × operation) a cell
// supplies the tenant filter, the hidden fields and the writable-field allow-list. No cell = PolicyDeniedError
// (deny by default). `systemScope()` has every cell; `hookScope()` has none in v1. Repositories never touch a
// collection except through `scoped()` below.
import type { ClientSession, Db, Document, Filter, UUID } from 'mongodb';

import type { Namespace } from './collections.ts';
import { isScope, type Scope } from './scope.ts';

export type Operation = 'find' | 'insert' | 'update' | 'delete';
type Kind = Exclude<Scope['kind'], 'system' | 'hook'>;

export class PolicyDeniedError extends Error {
  readonly namespace: string;
  readonly operation: string;
  readonly scope: string;
  constructor(namespace: string, operation: string, scope: string, reason = 'no policy cell') {
    super(`policy denied: ${scope} ${operation} ${namespace} (${reason})`);
    this.namespace = namespace;
    this.operation = operation;
    this.scope = scope;
  }
}

export interface PolicyContext {
  readonly scope: Scope;
  readonly db: Db;
  readonly session?: ClientSession | undefined;
  /** Set only by `contentWrite()`: the one masjid whose content this context may write (02 §5). */
  readonly contentMasjidId?: UUID | undefined;
}

export interface Cell {
  /** Tenant filter ANDed with every query (and every inserted document must match it). Absent = all documents. */
  readonly filter?: (ctx: PolicyContext) => Filter<Document> | Promise<Filter<Document>>;
  /** Fields never returned for this cell. */
  readonly hidden?: readonly string[];
  /** Top-level fields an update may change (`updated_at` always allowed). Required for `update` cells. */
  readonly writable?: readonly string[];
  /** Post-read redaction (e.g. removed items show no content to admins). */
  readonly redact?: (doc: Document) => Document;
  /**
   * Value rule for insert/update: given the inserted document, or ONE entry of an update at a time (`{ field: value }`
   * per operator and path; `$unset` → `undefined`), returns why it is refused, or `undefined`. For what an allow-list
   * of field names cannot say (e.g. items: never `removed`).
   */
  readonly check?: (fields: Readonly<Record<string, unknown>>) => string | undefined;
}

type Cells = Partial<Record<Kind, Partial<Record<Operation, Cell>>>>;

// --- tenant filters ---------------------------------------------------------------------------------------------------
const adminMasjids = (ctx: PolicyContext): UUID[] =>
  ctx.scope.kind === 'admin' ? ctx.scope.masjids.map((m) => m.id) : [];
const own = (field: string) => (ctx: PolicyContext) => ({ [field]: { $in: adminMasjids(ctx) } });
const selfAdmin = (field: string) => (ctx: PolicyContext) => ({
  [field]: ctx.scope.kind === 'admin' || ctx.scope.kind === 'super' ? ctx.scope.adminId : null,
});
const selfDevice = (field: string) => (ctx: PolicyContext) => ({
  [field]: ctx.scope.kind === 'device' ? ctx.scope.deviceId : null,
});
/** Admin: self + co-admins of the admin's masjids (02 §4.1 admin_users). */
const selfAndCoAdmins = async (ctx: PolicyContext) => {
  const self = ctx.scope.kind === 'admin' ? [ctx.scope.adminId] : [];
  const rows = await ctx.db
    .collection<{ admin_id: UUID }>('masjid_admins')
    .find({ masjid_id: { $in: adminMasjids(ctx) } }, { projection: { admin_id: 1 }, ...sessionOf(ctx) })
    .toArray();
  return { _id: { $in: [...self, ...rows.map((row) => row.admin_id)] } };
};
/** Admin: counters of dua items of the admin's masjids. */
const ownItemCounters = async (ctx: PolicyContext) => {
  const items = await ctx.db
    .collection<{ _id: UUID }>('items')
    .find({ masjid_id: { $in: adminMasjids(ctx) }, type: 'dua_request' }, { projection: { _id: 1 }, ...sessionOf(ctx) })
    .toArray();
  return { _id: { $in: items.map((item) => item._id) } };
};
const sessionOf = (ctx: PolicyContext) => (ctx.session ? { session: ctx.session } : {});
/** Admin audit entries: actor = this admin as `admin`, masjid = one of theirs or none (`null` in `$in` = missing field). */
const ownAuditEntry = (ctx: PolicyContext) => ({
  actor_type: 'admin',
  ...selfAdmin('actor_id')(ctx),
  masjid_id: { $in: [...adminMasjids(ctx), null] },
});
/** Device audit entries (follow / unfollow): actor = this device as `device` — never an admin, super admin or system. */
const ownDeviceAuditEntry = (ctx: PolicyContext) => ({ actor_type: 'device', ...selfDevice('actor_id')(ctx) });

const S: Cell = {};
const all = (writable?: readonly string[]): Partial<Record<Operation, Cell>> => ({
  find: S,
  insert: S,
  update: writable ? { writable } : { writable: ['*'] },
  delete: S,
});

/** Fields of a masjid an admin may change on their own masjid (02 §4.1). */
export const ADMIN_MASJID_FIELDS = [
  'photo_key',
  'photo_thumbhash',
  'show_chanda',
  'chanda_week_start',
  'ramadan_start',
  'ramadan_end',
  'sehri_precaution_min',
  'iftar_precaution_min',
  'hijri_offset',
] as const;
/** Fields the Super Admin may change directly; status, deletion, follow code and counters only via state functions. */
const SUPER_MASJID_FIELDS = [
  ...ADMIN_MASJID_FIELDS,
  'name',
  'name_i18n',
  'area',
  'city',
  'state',
  'address',
  'lat',
  'lng',
  'calc_method',
  'asr_madhab',
  'push_daily_quota',
  'verified_at',
];
const ITEM_WRITABLE = [
  'status',
  'audience',
  'title',
  'body',
  'content_locale',
  'template_key',
  'template_params',
  'is_important',
  'image_key',
  'image_thumbhash',
  'rights_confirmed',
  'notify',
  'published_at',
  'published_version',
  'edited_at',
  'deleted_at',
  'announcement',
  'daily',
  'dua',
  'campaign',
  'chanda',
  'video',
];
/**
 * 04 §5 "no generic update method exists for … item `removed` status" (security review M2): no generic write may set
 * `status: removed`, the moderation fields, or the purge marker (its 180-day evidence clock, IT Rules 3(1)(g)) —
 * takedown, restore and purge are state functions (Phase 8) and the retention job.
 */
const ITEM_MODERATION_FIELDS = ['purge_after', 'removed_at', 'removed_reason'];
const itemCheck = (fields: Readonly<Record<string, unknown>>): string | undefined => {
  if (fields['status'] === 'removed') return 'status removed is set by moderation only';
  const guarded = ITEM_MODERATION_FIELDS.find((field) => field in fields);
  return guarded ? `${guarded} is set by moderation / retention only` : undefined;
};
/** Generic item updates never touch a removed item (no un-removing). */
const notRemoved = { status: { $ne: 'removed' } };

const TIMING_WRITABLE = [
  'prayers',
  'jumuah',
  'rev',
  'updated_by',
  'type',
  'date',
  'label',
  'times',
  'note',
  'deleted_at',
];
const removedRedaction = (doc: Document): Document => {
  if (doc['status'] !== 'removed') return doc;
  const { title: _t, body: _b, image_key: _i, image_thumbhash: _h, ...rest } = doc;
  return rest;
};

const viewCells = (filter?: Cell['filter']): Cells => {
  const read: Cell = filter ? { filter } : S;
  return { public: { find: read }, device: { find: read }, admin: { find: read }, super: { find: read } };
};

/** 02 §4.1, cell by cell. */
export const POLICY: Readonly<Record<Namespace, Cells>> = {
  masjids: {
    admin: { find: { filter: own('_id') }, update: { filter: own('_id'), writable: ADMIN_MASJID_FIELDS } },
    super: { find: S, insert: S, update: { writable: SUPER_MASJID_FIELDS } },
  },
  masjid_stats: {
    device: { update: { writable: ['followers'] } },
    admin: { find: { filter: own('_id') } },
    super: { find: S },
  },
  admin_users: {
    admin: {
      find: { filter: selfAndCoAdmins, hidden: ['phone_enc', 'user_handle', 'undertaking_history'] },
      update: { filter: selfAdmin('_id'), writable: ['display_name', 'ui_locale'] },
    },
    super: {
      find: { hidden: ['phone_enc'] },
      insert: S,
      update: { writable: ['display_name', 'ui_locale', 'phone_enc', 'role', 'status', 'removed_at'] },
    },
  },
  masjid_admins: {
    admin: { find: { filter: own('masjid_id') } },
    super: { find: S, insert: S, delete: S },
  },
  webauthn_credentials: { super: { find: { hidden: ['public_key'] } } },
  admin_invites: { super: { find: { hidden: ['token_hash'] } } },
  admin_sessions: { super: { find: { hidden: ['token_hash'] } } },
  masjid_timings: {
    admin: {
      find: { filter: own('_id') },
      insert: { filter: own('_id') },
      update: { filter: own('_id'), writable: TIMING_WRITABLE },
      delete: { filter: own('_id') },
    },
    super: all(),
  },
  special_timings: {
    admin: {
      find: { filter: own('masjid_id') },
      insert: { filter: own('masjid_id') },
      update: { filter: own('masjid_id'), writable: TIMING_WRITABLE },
      delete: { filter: own('masjid_id') },
    },
    super: all(),
  },
  items: {
    admin: {
      find: { filter: own('masjid_id'), redact: removedRedaction },
      insert: { filter: own('masjid_id'), check: itemCheck },
      update: {
        filter: (ctx) => ({ ...own('masjid_id')(ctx), ...notRemoved }),
        writable: ITEM_WRITABLE,
        check: itemCheck,
      },
    },
    super: {
      ...all(),
      insert: { check: itemCheck },
      update: { filter: () => notRemoved, writable: ['*'], check: itemCheck },
    },
  },
  ameens: {
    device: { insert: { filter: selfDevice('device_id') }, delete: { filter: selfDevice('device_id') } },
  },
  ameen_counters: {
    public: { find: S },
    device: { find: S, insert: S, update: { writable: ['count'] } },
    admin: { find: { filter: ownItemCounters } },
    super: { find: S },
  },
  campaign_amount_history: {
    admin: { find: { filter: own('masjid_id') }, insert: { filter: own('masjid_id') } },
    super: { find: S },
  },
  chanda_weeks: {
    admin: {
      find: { filter: own('masjid_id') },
      insert: { filter: own('masjid_id') },
      update: { filter: own('masjid_id'), writable: ['amount_paise', 'note', 'item_id'] },
    },
    super: all(),
  },
  content_library: {
    admin: { find: { filter: () => ({ status: 'verified' }), hidden: ['search_text', 'import_batch_id'] } },
    super: all(),
  },
  notice_templates: {
    admin: { find: { filter: () => ({ status: 'active', system: false }) } },
    super: all(),
  },
  payment_profiles: {
    admin: { find: { filter: own('masjid_id') } },
    super: { find: S },
  },
  devices: {
    public: { insert: S },
    device: {
      find: { filter: selfDevice('_id'), hidden: ['secret_hash'] },
      update: {
        filter: selfDevice('_id'),
        writable: [
          'locale',
          'audience_pref',
          'platform',
          'push_endpoint',
          'push_p256dh',
          'push_auth',
          'push_status',
          'push_updated_at',
          'privacy_version',
          'follow_count',
          'last_seen_at',
        ],
      },
      delete: { filter: selfDevice('_id') },
    },
  },
  device_follows: {
    device: {
      find: { filter: selfDevice('device_id') },
      insert: { filter: selfDevice('device_id') },
      update: { filter: selfDevice('device_id'), writable: ['muted', 'audience_pref', 'locale', 'push_active'] },
      delete: { filter: selfDevice('device_id') },
    },
  },
  admin_push_subscriptions: {
    admin: {
      find: { filter: selfAdmin('admin_id') },
      insert: { filter: selfAdmin('admin_id') },
      delete: { filter: selfAdmin('admin_id') },
    },
    super: {
      find: { filter: selfAdmin('admin_id') },
      insert: { filter: selfAdmin('admin_id') },
      delete: { filter: selfAdmin('admin_id') },
    },
  },
  notification_jobs: { admin: { find: { filter: own('masjid_id') } }, super: { find: S } },
  push_quota_usage: { admin: { find: { filter: own('masjid_id') } }, super: { find: S } },
  reports: {
    device: { insert: { filter: selfDevice('device_id') } },
    admin: { find: { filter: own('masjid_id'), hidden: ['device_id'] } },
    super: { find: S, update: { writable: ['status', 'actioned_by', 'actioned_at', 'resolution_note', 'closed_at'] } },
  },
  grievances: {
    public: { insert: S },
    super: { find: S, update: { writable: ['status', 'acknowledged_at', 'resolved_at', 'resolution', 'handled_by'] } },
  },
  grievance_seq: {
    public: { find: S, insert: S, update: { writable: ['seq'] } },
    super: { find: S, update: { writable: ['seq'] } },
  },
  legal_orders: {
    super: {
      find: S,
      insert: S,
      update: { writable: ['action_taken', 'action_log', 'status', 'document_key', 'handled_by'] },
    },
  },
  audit_log: {
    device: { insert: { filter: ownDeviceAuditEntry } }, // phase-verifier N1 (22 Oct 2026)
    // An admin's entry names the admin as actor and one of their masjids or none (phase-verifier 22 Oct 2026): no
    // entries planted in another masjid's audit view.
    admin: { find: { filter: own('masjid_id') }, insert: { filter: ownAuditEntry } },
    super: { find: S, insert: S },
  },
  app_settings: {
    admin: { find: S },
    super: {
      find: S,
      update: {
        writable: [
          'global_hijri_offset',
          'maintenance_banner',
          'incident_banner',
          'default_push_quota',
          'undertaking_version',
          'privacy_version',
          'terms_version',
          'push_paused',
          'admin_read_only',
          'report_autohide_threshold',
          'grievance_officer',
          'support_whatsapp',
          'min_client_version',
          'updated_by',
        ],
      },
    },
  },
  stats_snapshots: { super: { find: S } },
  _migrations: {},
  v_pub_masjids: viewCells(),
  v_pub_masjid_status: viewCells(),
  v_pub_timings: viewCells(),
  v_pub_special_timings: viewCells(),
  v_pub_items: viewCells(),
  v_pub_chanda_weeks: viewCells(),
  v_pub_payment_profiles: viewCells(),
  v_pub_library: viewCells(),
  v_pub_templates: viewCells(),
  v_pub_settings: viewCells(),
  // Counts for push audiences without device ids (02 §4.2) — admins see only their own masjids.
  v_admin_follow_audience: { admin: { find: { filter: own('masjid_id') } }, super: { find: S } },
};

/**
 * The cell for (namespace, scope, operation).
 *
 * @throws PolicyDeniedError when no cell exists (deny by default) or the scope is not a genuine scope.
 */
export function cellFor(namespace: Namespace, scope: Scope, operation: Operation): Cell {
  if (!isScope(scope)) throw new PolicyDeniedError(namespace, operation, 'forged', 'not a scope');
  if (scope.kind === 'system') return operation === 'update' ? { writable: ['*'] } : S;
  if (scope.kind === 'hook') throw new PolicyDeniedError(namespace, operation, 'hook');
  const cell = POLICY[namespace][scope.kind]?.[operation];
  if (!cell) throw new PolicyDeniedError(namespace, operation, scope.kind);
  return cell;
}
