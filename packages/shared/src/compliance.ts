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
