import { IconFrame, type IconProps } from '../Icon.tsx';

/** Play button in a circle (bayan videos). */
export function PlayCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M108 88v80l64-40Z" />
    </IconFrame>
  );
}
