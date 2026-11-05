import { IconFrame, type IconProps } from '../Icon.tsx';

/** Pause (voice notes). */
export function PauseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 56v144M160 56v144" />
    </IconFrame>
  );
}
