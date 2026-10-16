// Fails when an OWASP ZAP baseline JSON report contains a Medium or High alert (review S-L13, verifier V-4), or when a
// scanned target has no report at all (re-review L7 — an empty directory used to pass):
//   node scripts/zap-gate.mjs <dir with *.json reports> <target URL>...
// zap-baseline.py reports every rule as WARN; with -I it never fails, so the risk gate lives here. Each target's report
// is `<host>.json` (the nightly workflow names them so) and must contain at least one scanned site.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...targets] = process.argv.slice(2);
if (!dir || targets.length === 0) throw new Error('usage: node scripts/zap-gate.mjs <report dir> <target URL>...');

let blocking = 0;
let missing = 0;
for (const target of targets) {
  const host = new URL(target).host;
  const file = join(dir, `${host}.json`);
  const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const sites = Array.isArray(report?.site) ? report.site : [];
  if (sites.length === 0) {
    missing += 1;
    process.stdout.write(`::error title=ZAP report missing::${host} — no report or no scanned site in ${file}\n`);
    continue;
  }
  for (const site of sites) {
    for (const alert of site.alerts ?? []) {
      if (Number(alert.riskcode) >= 2) {
        blocking += 1;
        process.stdout.write(`::error title=ZAP ${alert.riskdesc}::${site['@name']} — ${alert.name}\n`);
      }
    }
  }
}
process.stdout.write(`zap-gate: ${blocking} medium/high alert(s), ${missing} missing report(s)\n`);
process.exitCode = blocking > 0 || missing > 0 ? 1 : 0;
