import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { redisChallengeStore } from '../src/auth/challenges.ts';
import { clearRedisRateLimits, redisRateLimiter } from '../src/http/rate-limit.ts';
import { useTestRedis } from '../src/testing/vitest.ts';

// PHASE_01 T1.6 against the Docker Redis: the Redis limiter (atomic Lua under the ACL users' rights), its in-memory
// insurance when Redis is gone, and the per-process ACL users (04 §12.2) confined to their own key prefixes.
const redis = useTestRedis(import.meta.url);

const urlOf = (name: string): string => {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is not set — run \`pnpm setup:local\` and use \`pnpm test:int\``);
  return url;
};

const opened: Redis[] = [];
const connect = async (url: string) => {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  opened.push(client);
  await client.connect();
  return client;
};

let suffixValue = '';
const suffixOf = () => (suffixValue ||= randomBytes(4).toString('hex'));

afterAll(async () => {
  await Promise.all(opened.map((client) => client.quit().catch(() => undefined)));
});

describe('Redis rate limiter', () => {
  it('counts per key in Redis (hashed key, bucket TTL) and refuses over the limit', async () => {
    const { redis: client, prefix } = redis();
    // `rl:pub:` sits under the test user's per-file prefix here (ioredis prefixes the Lua script's keys).
    const limiter = redisRateLimiter(client, 'rl:pub:', { follow: { points: 3, durationSec: 3600 } });
    for (let i = 0; i < 3; i += 1) expect(await limiter.consume('follow', 'device-1')).toEqual({ allowed: true });
    const refused = await limiter.consume('follow', 'device-1');
    expect(refused).toMatchObject({ allowed: false });
    expect(refused.allowed ? 0 : refused.retryAfterSec).toBeGreaterThan(3500);
    expect(await limiter.consume('follow', 'device-2')).toEqual({ allowed: true });

    const [, keys] = await client.scan('0', 'MATCH', `${prefix}rl:pub:follow*`, 'COUNT', 1000);
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain('device-'); // stored hashed, never the raw id/IP
      const ttl = await client.ttl(key.slice(prefix.length));
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
    }
  });

  it('Redis unreachable → the in-memory insurance limiter still enforces the bucket', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    opened.push(dead);
    const limiter = redisRateLimiter(dead, 'rl:pub:', { ameen: { points: 2, durationSec: 3600 } });
    expect(await limiter.consume('ameen', 'device-x')).toEqual({ allowed: true });
    expect(await limiter.consume('ameen', 'device-x')).toEqual({ allowed: true });
    expect(await limiter.consume('ameen', 'device-x')).toMatchObject({ allowed: false });
  });
});

describe('Redis ACL users (04 §12.2): each process only reaches its own key prefixes', () => {
  const suffix = `t16-${randomBytes(4).toString('hex')}`;
  const USERS = [
    { env: 'REDIS_URL_TEST_RL_PUBLIC', own: ['rl:pub:'], foreign: ['rl:adm:', 'chal:', 'bull:', 'push:', 'alert:'] },
    { env: 'REDIS_URL_TEST_ADMIN', own: ['rl:adm:', 'chal:', 'bull:'], foreign: ['rl:pub:', 'push:', 'alert:'] },
    { env: 'REDIS_URL_TEST_WORKER', own: ['bull:', 'push:', 'alert:'], foreign: ['rl:pub:', 'rl:adm:', 'chal:'] },
  ] as const;

  for (const user of USERS) {
    it(`${user.env.replace('REDIS_URL_TEST_', '').toLowerCase()}: own prefixes yes, others NOPERM, no admin commands`, async () => {
      const client = await connect(urlOf(user.env));
      for (const prefix of user.own) {
        const key = `${prefix}${suffix}`;
        await client.set(key, '1', 'EX', 60);
        expect(await client.get(key)).toBe('1');
        await client.del(key);
      }
      for (const prefix of user.foreign) {
        await expect(client.set(`${prefix}${suffix}`, '1')).rejects.toThrow(/NOPERM/);
        await expect(client.get(`${prefix}${suffix}`)).rejects.toThrow(/NOPERM/);
      }
      await expect(client.set(`test:${suffix}`, '1')).rejects.toThrow(/NOPERM/);
      await expect(client.call('FLUSHALL')).rejects.toThrow(/NOPERM/);
      await expect(client.call('CONFIG', 'GET', 'requirepass')).rejects.toThrow(/NOPERM/);
      await expect(client.call('KEYS', '*')).rejects.toThrow(/NOPERM/);
    });
  }

  it('rl_public can run the limiter itself under rl:pub: (EVAL allowed for its keys)', async () => {
    const client = await connect(urlOf('REDIS_URL_TEST_RL_PUBLIC'));
    const limiter = redisRateLimiter(client, 'rl:pub:', { reports: { points: 1, durationSec: 60 } });
    const key = `acl-${suffix}`;
    expect(await limiter.consume('reports', key)).toEqual({ allowed: true });
    expect(await limiter.consume('reports', key)).toMatchObject({ allowed: false });
    // No SCAN for the API users (review L6); the counters expire with their 60-second window.
    await expect(client.scan('0', 'MATCH', 'rl:pub:reports*')).rejects.toThrow(/NOPERM/);
    const admin = redisRateLimiter(client, 'rl:adm:', { adminWrites: { points: 1, durationSec: 60 } });
    // Without insurance the store error would surface; with it, the request is still counted in memory.
    expect(await admin.consume('adminWrites', key)).toEqual({ allowed: true });
  });
});

describe('Redis challenge store (04 §3)', () => {
  it('GETDEL: a challenge is returned once; 5-minute TTL; the admin ACL user may use chal:*', async () => {
    const store = redisChallengeStore(redis().redis);
    const challenge = await store.issue('register', 'invite-x');
    expect(await store.take('register', 'invite-x')).toBe(challenge);
    expect(await store.take('register', 'invite-x')).toBeUndefined();
    await store.issue('login', 'cookie-y');
    const [, keys] = await redis().redis.scan('0', 'MATCH', `${redis().prefix}chal:login:*`, 'COUNT', 1000);
    expect(keys).toHaveLength(1);
    const ttl = await redis().redis.ttl((keys[0] ?? '').slice(redis().prefix.length));
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(keys[0]).not.toContain('cookie-y'); // binding hashed

    const admin = await connect(urlOf('REDIS_URL_TEST_ADMIN'));
    const adminStore = redisChallengeStore(admin);
    const issued = await adminStore.issue('step_up', `session-${suffixOf()}`);
    expect(await adminStore.take('step_up', `session-${suffixOf()}`)).toBe(issued);
    const publicUser = await connect(urlOf('REDIS_URL_TEST_RL_PUBLIC'));
    await expect(redisChallengeStore(publicUser).issue('login', 'z')).rejects.toThrow(/NOPERM/);
    // ACL key patterns do not filter SCAN results: the API users may not list key names (review L6).
    await expect(publicUser.scan('0', 'MATCH', '*')).rejects.toThrow(/NOPERM/);
  });
});

describe('clearing counters (e2e test hooks only)', () => {
  it('deletes the process’s rate-limit counters and nothing else under its ACL', async () => {
    const admin = await connect(urlOf('REDIS_URL_TEST_ADMIN'));
    const limiter = redisRateLimiter(admin, 'rl:adm:', { adminLoginIp: { points: 1, durationSec: 600 } });
    const key = `ip-${suffixOf()}`;
    expect(await limiter.consume('adminLoginIp', key)).toEqual({ allowed: true });
    expect((await limiter.consume('adminLoginIp', key)).allowed).toBe(false);
    const challenges = redisChallengeStore(admin);
    const challenge = await challenges.issue('login', `keep-${suffixOf()}`);

    expect(await clearRedisRateLimits(admin, 'rl:adm:')).toBeGreaterThanOrEqual(1);
    expect(await limiter.consume('adminLoginIp', key)).toEqual({ allowed: true });
    expect(await challenges.take('login', `keep-${suffixOf()}`)).toBe(challenge); // chal:* untouched
  });
});
