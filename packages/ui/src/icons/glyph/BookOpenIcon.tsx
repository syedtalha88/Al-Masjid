import { IconFrame, type IconProps } from '../Icon.tsx';

export function BookOpenIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 88a32 32 0 0 1 32-32h72v144h-72a32 32 0 0 0-32 32" />
      <path d="M24 200h72a32 32 0 0 1 32 32V88a32 32 0 0 0-32-32H24Z" />
    </IconFrame>
  );
}
