import { IconFrame, type IconProps } from '../Icon.tsx';

/** Bookmark (Save / Saved): outline, or `filled` once the item is saved. */
export function BookmarkIcon({ filled = false, ...props }: IconProps & { readonly filled?: boolean }) {
  return (
    <IconFrame {...props}>
      <path d="M192 224l-64-40-64 40V48a8 8 0 0 1 8-8h112a8 8 0 0 1 8 8Z" fill={filled ? 'currentColor' : 'none'} />
    </IconFrame>
  );
}
