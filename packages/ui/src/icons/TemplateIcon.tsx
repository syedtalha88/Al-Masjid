import { TEMPLATE_ICONS, type TemplateIconName } from '@mc/shared/contracts/template-icons';
import type { ComponentType } from 'react';

import { BowlFoodIcon } from './glyph/BowlFoodIcon.tsx';
import { BroomIcon } from './glyph/BroomIcon.tsx';
import { CalendarIcon } from './glyph/CalendarIcon.tsx';
import { CarIcon } from './glyph/CarIcon.tsx';
import { ClockIcon } from './glyph/ClockIcon.tsx';
import { CrescentIcon } from './glyph/CrescentIcon.tsx';
import { DropIcon } from './glyph/DropIcon.tsx';
import { HandsPrayingIcon } from './glyph/HandsPrayingIcon.tsx';
import { HeartbeatIcon } from './glyph/HeartbeatIcon.tsx';
import { HeartIcon } from './glyph/HeartIcon.tsx';
import { InfoIcon } from './glyph/InfoIcon.tsx';
import { LightningIcon } from './glyph/LightningIcon.tsx';
import { MapPinIcon } from './glyph/MapPinIcon.tsx';
import { MegaphoneIcon } from './glyph/MegaphoneIcon.tsx';
import { MoonStarsIcon } from './glyph/MoonStarsIcon.tsx';
import { MosqueIcon } from './glyph/MosqueIcon.tsx';
import { SearchIcon } from './glyph/SearchIcon.tsx';
import { WarningIcon } from './glyph/WarningIcon.tsx';
import { WrenchIcon } from './glyph/WrenchIcon.tsx';
import type { IconProps } from './Icon.tsx';

/** One glyph per allowed notice-template icon name (02 notice_templates.icon). */
export const TEMPLATE_ICON_GLYPHS: Readonly<Record<TemplateIconName, ComponentType<IconProps>>> = {
  drop: DropIcon,
  lightning: LightningIcon,
  clock: ClockIcon,
  mosque: MosqueIcon,
  crescent: CrescentIcon,
  calendar: CalendarIcon,
  broom: BroomIcon,
  car: CarIcon,
  wrench: WrenchIcon,
  warning: WarningIcon,
  moon_stars: MoonStarsIcon,
  bowl_food: BowlFoodIcon,
  search: SearchIcon,
  heart: HeartIcon,
  heartbeat: HeartbeatIcon,
  megaphone: MegaphoneIcon,
  info: InfoIcon,
  map_pin: MapPinIcon,
  hands_praying: HandsPrayingIcon,
};

export { TEMPLATE_ICONS };

const isTemplateIcon = (name: string): name is TemplateIconName => (TEMPLATE_ICONS as readonly string[]).includes(name);

/**
 * A notice template's icon by name (C9 editor, B5 template grid). An unknown name — a template stored before the icon
 * set changed — shows the megaphone rather than nothing.
 */
export function TemplateIcon({ name, ...props }: IconProps & { readonly name: string }) {
  const Glyph = isTemplateIcon(name) ? TEMPLATE_ICON_GLYPHS[name] : MegaphoneIcon;
  return <Glyph {...props} />;
}
