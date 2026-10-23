import { IconFrame, type IconProps } from '../Icon.tsx';

export function DotsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="64" cy="128" r="12" className="fill-current stroke-none" />
      <circle cx="128" cy="128" r="12" className="fill-current stroke-none" />
      <circle cx="192" cy="128" r="12" className="fill-current stroke-none" />
    </IconFrame>
  );
}
