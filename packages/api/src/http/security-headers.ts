import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Permissions-Policy for API responses (04 §7). `interest-cohort` is omitted: browsers no longer
 * recognise it and log a console error for it (DECISIONS #33).
 */
export const PERMISSIONS_POLICY =
  'camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=(), payment=(), usb=(), bluetooth=()';

/** HSTS without `preload` until DECISIONS #29 is resolved. */
export const HSTS = { maxAge: 63072000, includeSubDomains: true, preload: false } as const;

export interface SecurityHeaderOptions {
  /** Adds `X-Robots-Tag: noindex, nofollow` (admin origin and every staging host — 04 §7, T0.14). */
  readonly noindex: boolean;
}

/**
 * Middleware 2 (03 §0): security headers for API JSON responses (04 §7, "API JSON responses
 * additionally"). Only the headers the spec lists are emitted — helmet's extra defaults are disabled —
 * plus `Cache-Control: no-store` as the default (routes override it per 01 §5.2).
 */
export function securityHeaders({ noindex }: SecurityHeaderOptions): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      strictTransportSecurity: HSTS,
      xContentTypeOptions: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      xFrameOptions: { action: 'deny' },
      crossOriginEmbedderPolicy: false,
      originAgentCluster: false,
      xDnsPrefetchControl: false,
      xDownloadOptions: false,
      xPermittedCrossDomainPolicies: false,
      xXssProtection: false,
      xPoweredBy: false,
    }),
    (_req, res, next) => {
      res.set('Permissions-Policy', PERMISSIONS_POLICY);
      res.set('Cache-Control', 'no-store');
      if (noindex) res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
    },
  ];
}
