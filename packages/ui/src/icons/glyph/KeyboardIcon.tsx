import { IconFrame, type IconProps } from '../Icon.tsx';

/** Keyboard (enter a code instead). */
export function KeyboardIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="24" y="56" width="208" height="144" rx="8" />
      <path d="M64 96h16M104 96h16M144 96h16M184 96h8M64 128h8M96 128h16M136 128h16M176 128h16M80 160h96" />
    </IconFrame>
  );
}
