import { z } from 'zod';

// `/licenses.json` (05 §10, PHASE_08 T8.6): generated at build by `mcLicenses` (@mc/ui/vite), read by the Licenses
// screens. Bounded so a malformed file cannot flood the page.
export const licensesFileSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string().max(214),
        version: z.string().max(200),
        license: z.string().max(300),
        homepage: z
          .string()
          .regex(/^https:\/\//u)
          .optional(),
      }),
    )
    .max(5000),
});
