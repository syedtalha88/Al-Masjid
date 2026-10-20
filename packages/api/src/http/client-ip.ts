import { isIP } from 'node:net';

import type { Request } from 'express';

export type TrustedProxyMode = 'cloudflare' | 'none';

/**
 * Client IP for **coarse rate limits only** — never stored or logged (03 §0).
 *
 * - `cloudflare`: `CF-Connecting-IP` (the origin firewall only admits Cloudflare, 04 §12.2).
 * - `none` (local): the socket address.
 *
 * @returns a syntactically valid IP, or `null` when the header/socket gives nothing usable.
 */
export function clientIp(req: Request, mode: TrustedProxyMode): string | null {
  const candidate = mode === 'cloudflare' ? req.get('cf-connecting-ip')?.trim() : req.socket.remoteAddress;
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : null;
}

/** Expands an IPv6 address into its eight 16-bit groups (embedded IPv4 allowed), or `null`. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const part = (s: string | undefined) => (s ? s.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const head = part(halves[0]);
  const tail = part(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array.from({ length: fill }, () => 0), ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The key an IP counts under in the `ip` rate-limit buckets (security review M1, 20 Oct 2026): IPv4 as is; IPv6 by its
 * /64 — one connection (home, phone, VPS) usually holds a whole /64, so per-address keys could be rotated around
 * the limit at will. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as the IPv4 address.
 *
 * @param ip - a valid IP (from {@link clientIp}).
 */
export function rateLimitIpKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = groups.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
