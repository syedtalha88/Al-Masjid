import { IconFrame, type IconProps } from '../Icon.tsx';

/** Iftar / food — Phosphor `bowl-food` (regular), MIT (../PHOSPHOR_LICENSE). */
export function BowlFoodIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M48,112a80,80,0,0,1,160,0" />
      <path d="M89.6,112A80,80,0,0,1,168,48a81.61,81.61,0,0,1,8.61.46" />
      <path d="M134.66,112A80.13,80.13,0,0,1,193,65.4" />
      <path d="M88,199.3A96,96,0,0,1,32,112H224a96,96,0,0,1-56,87.3V208a8,8,0,0,1-8,8H96a8,8,0,0,1-8-8Z" />
    </IconFrame>
  );
}
