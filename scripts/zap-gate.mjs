// Fails when an OWASP ZAP baseline JSON report contains a Medium or High alert (review S-L13, verifier V-4):
//   node scripts/zap-gate.mjs <dir with *.json reports>
// zap-baseline.py reports every rule as WARN; with -I it never fails, so the risk gate lives here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/zap-gate.mjs <report dir>');

let blocking = 0;
for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      if (Number(alert.riskcode) >= 2) {
        blocking += 1;
        process.stdout.write(`::error title=ZAP ${alert.riskdesc}::${site['@name']} — ${alert.name}\n`);
      }
    }
  }
}
process.stdout.write(`zap-gate: ${blocking} medium/high alert(s)\n`);
process.exitCode = blocking > 0 ? 1 : 0;
