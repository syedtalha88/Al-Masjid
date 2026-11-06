import { IconFrame, type IconProps } from '../Icon.tsx';

/** Night prayers (Taraweeh) — Phosphor `moon-stars` (regular), MIT (../PHOSPHOR_LICENSE). */
export function MoonStarsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <line x1="208" y1="120" x2="208" y2="72" />
      <line x1="232" y1="96" x2="184" y2="96" />
      <line x1="160" y1="32" x2="160" y2="64" />
      <line x1="176" y1="48" x2="144" y2="48" />
      <path d="M210.69,158.18A96.78,96.78,0,0,1,192,160,96.08,96.08,0,0,1,97.82,45.31,88,88,0,1,0,210.69,158.18Z" />
    </IconFrame>
  );
}
