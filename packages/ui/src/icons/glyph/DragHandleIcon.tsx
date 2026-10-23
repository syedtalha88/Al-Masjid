import { IconFrame, type IconProps } from '../Icon.tsx';

/** Drag handle (reorder mode — three bars). */
export function DragHandleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 92h176M40 128h176M40 164h176" />
    </IconFrame>
  );
}
