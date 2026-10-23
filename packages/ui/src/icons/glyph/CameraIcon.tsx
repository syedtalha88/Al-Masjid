import { IconFrame, type IconProps } from '../Icon.tsx';

/** Camera (scanner permission). */
export function CameraIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M208 208H48a16 16 0 0 1-16-16V80a16 16 0 0 1 16-16h32l16-24h64l16 24h32a16 16 0 0 1 16 16v112a16 16 0 0 1-16 16Z" />
      <circle cx="128" cy="132" r="36" />
    </IconFrame>
  );
}
