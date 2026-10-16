// Entrypoint: `deploy.sh <env> --verify-roles` runs this in each process's one-off container (PHASE_01 T1.1). It finds
// the process's own MongoDB URI, asks MongoDB which privileges that user really has (read-only) and compares them with
// 02 §4.3. Prints PASS/FAIL lines with names only — never the connection string. Exit 1 on any FAIL.
import { userFromEnv, verifyRoles } from '@mc/db';

const database = process.env['MONGODB_DB_NAME'] ?? '';
const local = process.env['APP_ENV'] === 'local';
let failed = false;
try {
  const { user, uri } = userFromEnv(process.env);
  for (const check of await verifyRoles(uri, database, user, { local })) {
    failed ||= !check.ok;
    const detail = check.detail ? ` — ${check.detail}` : '';
    process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${user}: ${check.name}${detail}\n`);
  }
} catch (error) {
  failed = true;
  process.stdout.write(`FAIL  ${error instanceof Error ? error.message : 'unknown error'}\n`);
}
process.exitCode = failed ? 1 : 0;
