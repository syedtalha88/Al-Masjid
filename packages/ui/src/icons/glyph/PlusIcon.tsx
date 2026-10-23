import { IconFrame, type IconProps } from '../Icon.tsx';

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 128h176M128 40v176" />
    </IconFrame>
  );
}
