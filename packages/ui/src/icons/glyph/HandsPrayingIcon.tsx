import { IconFrame, type IconProps } from '../Icon.tsx';

/** Two raised hands (dua requests). */
export function HandsPrayingIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M120 216V112l-28-60a12 12 0 0 0-22 9l14 51-34 54v50" />
      <path d="M136 216V112l28-60a12 12 0 0 1 22 9l-14 51 34 54v50" />
    </IconFrame>
  );
}
