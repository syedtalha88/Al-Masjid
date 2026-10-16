// `@mc/db/repos` — typed, policy-enforced read repositories per aggregate (T1.4/T1.11).
export {
  type AdminOfMasjid,
  type AuditRow,
  getDashboard,
  getMasjidDetail,
  getSettings,
  listAudit,
  listMasjids,
  type MasjidRow,
} from './super.ts';
