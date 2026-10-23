// `@mc/ui/motion` — the only source of animation timing in the apps (08_MOTION; lint rule mc/no-adhoc-motion).
export { CountUp, type CountUpProps } from './CountUp.tsx';
export { DigitRoll, type DigitRollProps } from './DigitRoll.tsx';
export { breathe, crossfadeIn, drawStrokesIn, type Effect, shake, slideIn, snapTo, sweep } from './effects.ts';
export { haptic, type HapticKind, HAPTICS, isHapticsEnabled, setHapticsEnabled, useHaptics } from './haptics.ts';
export { type DeviceHints, isLowEndDevice, JANK, JankMonitor, trackMotion, useLiteMotion } from './lite.ts';
export {
  type MotionPrefs,
  MotionPrefsOverride,
  MotionProvider,
  type MotionProviderProps,
  useMotionPrefs,
} from './MotionProvider.tsx';
export { CROSSFADE, motionOrFade, type Presence } from './presence.ts';
export { Pressable, type PressableProps } from './Pressable.tsx';
export { useReducedMotionPref } from './reduced.ts';
export { SuccessCheck, type SuccessCheckProps } from './SuccessCheck.tsx';
export {
  css,
  feedback,
  gesture,
  loop,
  navigation,
  press,
  type PressKind,
  spring,
  springPhysics,
  type SpringToken,
  stagger,
  tween,
} from './tokens.ts';
