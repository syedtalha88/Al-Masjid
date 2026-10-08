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
