import { describe, expect, it } from 'vitest';

import { escapeHtml, previewTags } from '../src/routes/link-preview.ts';

describe('previewTags', () => {
  it('never lets a Caddy template action through (security review H1)', () => {
    const tags = previewTags({
      title: '{{env `MC_SECRET`}} Masjid',
      description: '{{httpInclude "/api/v1/devices/me"}} {{b64dec `PHA+`}}',
      url: 'https://app.example/p/{{x}}',
    });
    expect(tags).not.toMatch(/[{}]/);
    expect(tags).toContain('content="&#123;&#123;env `MC_SECRET`&#125;&#125; Masjid"');
    expect(escapeHtml('{}')).toBe('&#123;&#125;');
  });

  it('escapes every value; absolute URLs only with an app origin', () => {
    const html = previewTags({
      title: 'Masjid "<script>alert(1)</script>" & Co\'s',
      description: '<img src=x onerror=alert(1)>',
      url: 'https://app.example.com/m/ABCD2345',
      appOrigin: 'https://app.example.com',
    });
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain('content="Masjid &quot;&lt;script&gt;alert(1)&lt;/script&gt;&quot; &amp; Co&#39;s"');
    expect(html).toContain('<meta property="og:url" content="https://app.example.com/m/ABCD2345">');
    expect(html).toContain('<meta property="og:image" content="https://app.example.com/icons/icon-512.png">');
    expect(previewTags({ title: 't', description: 'd' })).not.toContain('og:image');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});
