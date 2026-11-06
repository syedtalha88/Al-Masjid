// Icons a notice template may use (02 notice_templates.icon, 07 C9): names of glyphs in @mc/ui (TemplateIcon). A
// separate module so the musalli app and the API can import the list without the admin contracts.
export const TEMPLATE_ICONS = [
  'drop',
  'lightning',
  'clock',
  'mosque',
  'crescent',
  'calendar',
  'broom',
  'car',
  'wrench',
  'warning',
  'moon_stars',
  'bowl_food',
  'search',
  'heart',
  'heartbeat',
  'megaphone',
  'info',
  'map_pin',
  'hands_praying',
] as const;
export type TemplateIconName = (typeof TEMPLATE_ICONS)[number];
