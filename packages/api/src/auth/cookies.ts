// Admin cookies (04 §4, 03 §4): `__Host-` names — Secure, Path=/ and no Domain are required by the browser for that
// prefix, so the cookie can never be set or read by a sibling subdomain. HttpOnly + SameSite=Strict always.
import type { Request, Response } from 'express';

/** Session cookie: opaque 32-byte token (base64url). */
export const SESSION_COOKIE = '__Host-mc_sess';
/** Login challenge id cookie (5 minutes) — binds a discoverable-login challenge to this browser. */
export const CHALLENGE_COOKIE = '__Host-mc_chal';

/** Our cookie values are base64url tokens; anything else is ignored rather than parsed. */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Reads one of our cookies from the `Cookie` header.
 *
 * @returns the value, or `undefined` when absent, duplicated (a planted second cookie) or not token-shaped.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.get('cookie');
  if (!header) return undefined;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  const [value] = values;
  return values.length === 1 && value !== undefined && TOKEN.test(value) ? value : undefined;
}

/** Sets one of our cookies (`Max-Age` in seconds). */
export function setCookie(res: Response, name: string, value: string, maxAgeSec: number): void {
  res.append(
    'Set-Cookie',
    `${name}=${value}; Max-Age=${String(Math.max(0, Math.floor(maxAgeSec)))}; Path=/; Secure; HttpOnly; SameSite=Strict`,
  );
}

/** Deletes one of our cookies. */
export function clearCookie(res: Response, name: string): void {
  res.append('Set-Cookie', `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict`);
}
