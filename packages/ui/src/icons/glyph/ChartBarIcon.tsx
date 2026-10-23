import { IconFrame, type IconProps } from '../Icon.tsx';

/** Bar chart (chanda). */
export function ChartBarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M32 216h192" />
      <path d="M56 216v-72h40v72" />
      <path d="M108 216V96h40v120" />
      <path d="M160 216V48h40v168" />
    </IconFrame>
  );
}
