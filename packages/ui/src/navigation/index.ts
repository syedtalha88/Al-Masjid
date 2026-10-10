// `@mc/ui/navigation` — stack navigator, tab bar and screen layout (08 §3, 06 §6).
export { type AdapterLocation, type NavAdapter, type ResolvedScreen, tanstackAdapter } from './adapter.ts';
export { type NavigatorApi, type ScreenInfo, useNavigator, useScreen } from './context.ts';
export {
  BackIcon,
  CloseIcon,
  HomeIcon,
  type IconWeight,
  MasjidsIcon,
  ScanIcon,
  SettingsIcon,
  UpdatesIcon,
  type WeightedIconProps,
} from './icons.tsx';
export { type NavConfig, type TabConfig } from './model.ts';
export { Screen, type ScreenProps } from './Screen.tsx';
export { StackNavigator, type StackNavigatorProps } from './StackNavigator.tsx';
export { TabBar, type TabBarProps, type TabItem } from './TabBar.tsx';
