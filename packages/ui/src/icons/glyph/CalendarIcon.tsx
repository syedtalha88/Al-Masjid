import { IconFrame, type IconProps } from '../Icon.tsx';

export function CalendarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="40" y="40" width="176" height="176" rx="8" />
      <path d="M176 24v32M80 24v32M40 88h176" />
    </IconFrame>
  );
}
