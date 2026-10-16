// `pnpm db:roles:atlas` — writes infra/mongo/atlas-roles.json (the Atlas custom roles for 02 §4.3) for
// infra/vps/atlas-users.sh. A unit test fails when the committed file is stale.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { atlasRolesFile } from '@mc/db';

const out = fileURLToPath(new URL('../infra/mongo/atlas-roles.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(atlasRolesFile('masjid_connect'), null, 2)}\n`);
process.stdout.write('db:roles:atlas — infra/mongo/atlas-roles.json written\n');
