// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TEMPLATE_ICON_GLYPHS, TEMPLATE_ICONS, TemplateIcon } from '../src/icons/TemplateIcon.tsx';

// 07 C9 / B5: every allowed template icon name has a glyph; an unknown stored name still shows an icon.
describe('TemplateIcon', () => {
  it('has a glyph for every allowed name, and nothing else', () => {
    expect(Object.keys(TEMPLATE_ICON_GLYPHS).sort()).toEqual([...TEMPLATE_ICONS].sort());
  });

  it('renders each name as a stroke icon; an unknown name falls back to the megaphone', () => {
    for (const name of [...TEMPLATE_ICONS, 'retired-icon']) {
      const { container, unmount } = render(<TemplateIcon name={name} title={name} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-label')).toBe(name);
      expect(svg?.children.length).toBeGreaterThan(0);
      unmount();
    }
  });
});
