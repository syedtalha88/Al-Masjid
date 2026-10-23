import { IconFrame, type IconProps } from '../Icon.tsx';

export function XIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M200 56L56 200M200 200L56 56" />
    </IconFrame>
  );
}
