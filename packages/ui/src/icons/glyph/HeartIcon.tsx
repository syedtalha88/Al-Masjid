import { IconFrame, type IconProps } from '../Icon.tsx';

export function HeartIcon({ filled, ...props }: IconProps & { readonly filled?: boolean }) {
  return (
    <IconFrame {...props}>
      <path
        d="M128 216S24 160 24 94a54 54 0 0 1 104-20.4A54 54 0 0 1 232 94c0 66-104 122-104 122Z"
        className={filled ? 'fill-current' : undefined}
      />
    </IconFrame>
  );
}
