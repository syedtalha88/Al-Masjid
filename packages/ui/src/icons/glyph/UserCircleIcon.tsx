import { IconFrame, type IconProps } from '../Icon.tsx';

/** Person in a circle (my account). */
export function UserCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <circle cx="128" cy="112" r="36" />
      <path d="M63.8 199.4a72 72 0 0 1 128.4 0" />
    </IconFrame>
  );
}
