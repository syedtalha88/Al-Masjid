import { IconFrame, type IconProps } from '../Icon.tsx';

/** Check in a filled circle (Verified badge, success rows). */
export function CheckCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" className="fill-current" />
      <path d="M88 136l24 24 56-56" className="stroke-surface" />
    </IconFrame>
  );
}
