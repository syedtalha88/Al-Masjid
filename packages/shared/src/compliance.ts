// Compliance timelines (05 §3, §6; PHASE_08). Every deadline is a constant here so the owner can change it after legal
// review without touching the code that uses it. Defaults follow the IT Rules as amended in Feb 2026 (05 §3); the
// owner confirms them with a lawyer before launch.

const HOUR_MS = 60 * 60 * 1000;

/** Report reasons (00 §4.7, 02 §1 `report_reason`). */
export const REPORT_REASONS = [
  'misleading',
  'hateful',
  'off_topic',
  'fraud',
  'private_info',
  'copyright',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Why the Super Admin removed a post (C5 "reason category", 05 §3): a report reason, or a court / government order.
 * Stored on the item as `removed_reason`; the masjid's admins see the category (never the private note).
 */
export const MODERATION_CATEGORIES = [...REPORT_REASONS, 'legal_order'] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** The Super Admin's private moderation note on a removal or a dismissal. */
export const MODERATION_NOTE_MAX = 500;

/** Repeat violations (05 §3): removals per masjid counted over this window, shown on its Super Admin page. */
export const REPEAT_VIOLATION_WINDOW_MS = 90 * 24 * HOUR_MS;

/** Free-text details a reporter may add (02 §2 reports.details). */
export const REPORT_DETAILS_MAX = 500;

/** 05 §3 SLAs, in milliseconds from receipt. */
export const SLA_MS = {
  /** Complaint alleging non-consensual intimate imagery / impersonation / morphed content. */
  urgentReport: 2 * HOUR_MS,
  /** Any other content complaint. */
  report: 36 * HOUR_MS,
  /** Court order / reasoned government notice (Rule 3(1)(d)). */
  legalOrder: 3 * HOUR_MS,
  /** User grievance: acknowledgement, then resolution (resolution: owner to confirm). */
  grievanceAck: 24 * HOUR_MS,
  grievanceResolve: 72 * HOUR_MS,
} as const;

/**
 * Reasons that go to the urgent queue (05 §3: 2 hours, immediate Super Admin alert). "Personal or private information"
 * is the reason a person picks for intimate imagery, impersonation or morphed content about them.
 */
export const URGENT_REPORT_REASONS: readonly ReportReason[] = ['private_info'];

/** Auto-hide (PHASE_08 T8.1): this many distinct devices reporting one item within the window hide it for review. */
export const REPORT_AUTOHIDE_DEFAULT_THRESHOLD = 10;
export const REPORT_AUTOHIDE_WINDOW_MS = HOUR_MS;

/** Reports a device may send per day (03 §1 rate limits). */
export const REPORTS_PER_DEVICE_PER_DAY = 10;

/**
 * Whether a report with this reason is urgent and when it is due.
 *
 * @param reason - the report reason.
 * @param receivedAt - when the server received it.
 * @returns `urgent` and `slaDueAt` (2 h for urgent reasons, 36 h otherwise). Never throws.
 */
export function reportSla(reason: ReportReason, receivedAt: Date): { urgent: boolean; slaDueAt: Date } {
  const urgent = URGENT_REPORT_REASONS.includes(reason);
  return {
    urgent,
    slaDueAt: new Date(receivedAt.getTime() + (urgent ? SLA_MS.urgentReport : SLA_MS.report)),
  };
}

/** 05 §3: the Super Admin is alerted at these shares of an SLA's time (once each per target — T8.3). */
export const SLA_ALERT_LEVELS = [50, 80, 100] as const;
export type SlaAlertLevel = (typeof SLA_ALERT_LEVELS)[number];

/** C1: a timer turns red when less than this share of its time is left. */
export const SLA_RED_SHARE = 0.2;

/**
 * Where a timer stands (C1 cards, the `sla-alerts` job).
 *
 * @param start - when the clock started (received / created).
 * @param due - when it is due.
 * @param now - now.
 * @returns `level` — the highest of 50 / 80 / 100 % reached (0 before half-time); `red` — under 20 % left; `overdue`.
 */
export function slaProgress(
  start: Date,
  due: Date,
  now: Date,
): { level: 0 | SlaAlertLevel; red: boolean; overdue: boolean } {
  const total = due.getTime() - start.getTime();
  const used = total <= 0 ? 1 : (now.getTime() - start.getTime()) / total;
  const level = used >= 1 ? 100 : used >= 0.8 ? 80 : used >= 0.5 ? 50 : 0;
  return { level, red: used > 1 - SLA_RED_SHARE, overdue: now.getTime() >= due.getTime() };
}
