// Build-time client variables read with dot access: Vite replaces `import.meta.env.NAME` statically, so code
// behind a false flag is removed from the bundle (a bracket access would not be). Validated in vite.config.ts.
interface ImportMetaEnv {
  /** `'true'` only in staging builds (deploy-staging.yml): ships `/_dev/showcase` as a lazy chunk (DECISIONS #58). */
  readonly VITE_PUBLIC_SHOWCASE?: 'true' | 'false';
}
