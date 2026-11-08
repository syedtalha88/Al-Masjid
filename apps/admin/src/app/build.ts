// Build-time switches of the admin app.

/**
 * Tiles and screens of later phases show "Coming soon" in dev and staging builds only — never in production
 * (PHASE_03 T3.1: "hidden in production builds until their phase").
 */
export const SHOW_COMING_SOON = import.meta.env.DEV || import.meta.env.VITE_PUBLIC_SHOWCASE === 'true';

/** The Super Admin's "Send a test alert" (T4.6): dev and staging builds only (the API refuses it in production too). */
export const SHOW_TEST_ALERT = SHOW_COMING_SOON;
