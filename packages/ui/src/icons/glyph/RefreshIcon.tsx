import { IconFrame, type IconProps } from '../Icon.tsx';

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M176 104h48V56" />
      <path d="M188.4 192a88 88 0 1 1 1.8-126.2L224 104" />
    </IconFrame>
  );
}
