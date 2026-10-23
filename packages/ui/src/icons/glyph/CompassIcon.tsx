import { IconFrame, type IconProps } from '../Icon.tsx';

/** Compass (the Qibla button on Home). */
export function CompassIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M168 88l-24 56-56 24 24-56Z" />
    </IconFrame>
  );
}
