import { IconFrame, type IconProps } from '../Icon.tsx';

export function CopyIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M168 168h48V40H88v48" />
      <rect x="40" y="88" width="128" height="128" rx="8" />
    </IconFrame>
  );
}
