import { IconFrame, type IconProps } from '../Icon.tsx';

/** Sign out (door with arrow). */
export function SignOutIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M112 40H48v176h64" />
      <path d="M112 128h112M184 88l40 40-40 40" />
    </IconFrame>
  );
}
