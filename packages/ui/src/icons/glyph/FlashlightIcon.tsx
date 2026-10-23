import { IconFrame, type IconProps } from '../Icon.tsx';

/** Flashlight (scanner torch). */
export function FlashlightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M184 32H72a8 8 0 0 0-8 8v32l32 48v104a8 8 0 0 0 8 8h48a8 8 0 0 0 8-8V120l32-48V40a8 8 0 0 0-8-8Z" />
      <path d="M64 72h128M128 136v32" />
    </IconFrame>
  );
}
