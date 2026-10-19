import { describe, expect, it } from 'vitest';

import { configureZodForCsp } from './browser.ts';

describe('configureZodForCsp', () => {
  it('set before Zod loads: Zod starts jitless and still parses', async () => {
    configureZodForCsp();
    const { z } = await import('zod'); // first load of zod in this file
    expect(z.config().jitless).toBe(true);
    const schema = z.object({ id: z.string(), n: z.int().min(0) });
    expect(schema.parse({ id: 'a', n: 1 })).toEqual({ id: 'a', n: 1 });
    expect(schema.safeParse({ id: 'a', n: -1 }).success).toBe(false);
  });
});
