import { IconFrame, type IconProps } from '../Icon.tsx';

/** Crescent moon (special dates & Ramadan). */
export function CrescentIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M200 160A88 88 0 0 1 96 56a88 88 0 1 0 104 104Z" />
    </IconFrame>
  );
}
