/** Zod 4 keeps its global config on `globalThis` and reads `jitless` while each schema is constructed. */
interface ZodGlobal {
  __zod_globalConfig?: { jitless?: boolean };
}

/**
 * Browser setup for the PWAs (04 §7). Zod 4 probes whether it may compile parsers with `Function('')`; under our CSP
 * (`require-trusted-types-for 'script'`, no `unsafe-eval`) that probe is reported as a Trusted Types violation even
 * though Zod catches it. `jitless` skips the probe and the compiled fast path; parsing results are identical.
 *
 * Zod reads the flag when a schema is **constructed** — at module load of whatever chunk defines it, which the bundler
 * evaluates before the entry module's own code. So it runs first in the classic `/boot.js` (`mcLocaleBoot({ before })`),
 * serialized with `toString`: it must stay self-contained, and this file must never import `zod`. Servers keep the
 * default.
 *
 * @returns nothing; sets `globalThis.__zod_globalConfig.jitless`.
 */
export function configureZodForCsp(): void {
  const scope = globalThis as typeof globalThis & ZodGlobal; // Zod's documented global slot
  scope.__zod_globalConfig = { ...scope.__zod_globalConfig, jitless: true };
}
