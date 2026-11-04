import { IconFrame, type IconProps } from '../Icon.tsx';

/** Pencil ("Write your own" notice — 07 B5). */
export function PencilIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M92.7 216H48a8 8 0 0 1-8-8v-44.7a8 8 0 0 1 2.3-5.6L162.3 37.7a8 8 0 0 1 11.4 0l44.6 44.6a8 8 0 0 1 0 11.4L98.3 213.7a8 8 0 0 1-5.6 2.3Z" />
      <path d="M136 64l56 56" />
    </IconFrame>
  );
}
