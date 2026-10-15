// Writes release-manifest.json for a deploy workflow (DECISIONS #27): the image digests the VPS deploys.
// Env: ENVIRONMENT (staging|production), RELEASE (commit SHA), REGISTRY, SERVER_DIGEST, WEB_DIGEST (optional
// for staging until its web variables exist). Fails on anything malformed — a bad manifest must never ship.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const problems = [];
if (env['ENVIRONMENT'] !== 'staging' && env['ENVIRONMENT'] !== 'production') problems.push('ENVIRONMENT');
if (!/^[0-9a-f]{40}$/.test(env['RELEASE'] ?? '')) problems.push('RELEASE');
if (!/^ghcr\.io\/[a-z0-9-]+$/.test(env['REGISTRY'] ?? '')) problems.push('REGISTRY');
if (!DIGEST.test(env['SERVER_DIGEST'] ?? '')) problems.push('SERVER_DIGEST');
const web = env['WEB_DIGEST'] ?? '';
if (web !== '' && !DIGEST.test(web)) problems.push('WEB_DIGEST');
if (web === '' && env['ENVIRONMENT'] === 'production') problems.push('WEB_DIGEST (required for production)');
if (problems.length > 0) {
  process.stderr.write(`release-manifest: invalid ${problems.join(', ')}\n`);
  process.exit(1);
}

/** sha256 of a host-layer file at this commit: the VPS deploys only when its installed copy matches (DECISIONS #61). */
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const registry = env['REGISTRY'];
const manifest = {
  environment: env['ENVIRONMENT'],
  release: env['RELEASE'],
  created: new Date().toISOString(),
  images: {
    server: `${registry}/al-masjid-server@${env['SERVER_DIGEST']}`,
    ...(web === '' ? {} : { web: `${registry}/al-masjid-web@${web}` }),
  },
  hostLayer: {
    compose: sha256('infra/compose/docker-compose.vps.yml'),
    redis: sha256('infra/compose/redis.conf'),
  },
};
const json = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync('release-manifest.json', json);
process.stdout.write(json);
if (env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(
    env['GITHUB_STEP_SUMMARY'],
    `### ${String(manifest.environment)} release\n\n\`\`\`json\n${json}\`\`\`\n`,
  );
}
