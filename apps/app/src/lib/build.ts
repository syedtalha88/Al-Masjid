// Build-time switches of the musalli app.

/**
 * Placeholders for later phases ("Coming soon" rows) exist in dev and staging builds
 * only — never in production (PHASE_02 "Out of scope").
 */
export const SHOW_COMING_SOON = import.meta.env.DEV || import.meta.env['VITE_PUBLIC_SHOWCASE'] === 'true';
