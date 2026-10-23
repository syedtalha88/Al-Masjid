import { IconFrame, type IconProps } from '../Icon.tsx';

export function PlusSquareIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="40" y="40" width="176" height="176" rx="16" />
      <path d="M88 128h80M128 88v80" />
    </IconFrame>
  );
}
