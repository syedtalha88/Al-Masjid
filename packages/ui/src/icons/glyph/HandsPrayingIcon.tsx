import { IconFrame, type IconProps } from '../Icon.tsx';

/** Two raised hands (dua requests) — Phosphor `hands-praying` (regular), MIT (../PHOSPHOR_LICENSE). */
export function HandsPrayingIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M141.78 16A13.77 13.77 0 0 1 155 25.78L192 148l20.27 20.27-45 43-29.94-29.94A32 32 0 0 1 128 158.75v-129A13.78 13.78 0 0 1 141.78 16Z" />
      <path d="m167.31 211.31 18.35 18.35a8 8 0 0 0 11.31 0L229.66 197a8 8 0 0 0 0-11.31l-18.35-18.35" />
      <path d="M118.63 181.37 88.69 211.31l-44-44L64 148l37-122.22A13.77 13.77 0 0 1 114.22 16 13.78 13.78 0 0 1 128 29.78v129a32 32 0 0 1-9.37 22.59Z" />
      <path d="M44.69 167.31 26.34 185.66a8 8 0 0 0 0 11.31L59 229.66a8 8 0 0 0 11.31 0l18.35-18.35" />
    </IconFrame>
  );
}
