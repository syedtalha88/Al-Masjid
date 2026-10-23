import { IconFrame, type IconProps } from '../Icon.tsx';

export function MegaphoneIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M160 80v120a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8v-40H64a32 32 0 0 1 0-64h96l64-40v168l-64-40" />
      <path d="M96 160v48a8 8 0 0 0 8 8h16" />
    </IconFrame>
  );
}
