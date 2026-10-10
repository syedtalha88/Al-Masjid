// Loaded lazily by MotionProvider so the animation engine is not part of the initial JS (01 §9, 08 §9).
// The stack navigator chunk loads `domMax` (layout/drag) itself in T0.9.
import { domAnimation } from 'motion/react';

export default domAnimation;
