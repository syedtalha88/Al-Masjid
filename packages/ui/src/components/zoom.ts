// Pinch-zoom geometry for the full-screen image viewer (07 A7): transforms are `translate(x, y) scale(s)` around the
// stage centre; every function is pure so the gesture code only feeds pointer positions in.

export interface ZoomState {
  readonly scale: number;
  /** Offset of the image centre from the stage centre, px. */
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** Double-tap zooms to this (or back to 1). */
export const DOUBLE_TAP_SCALE = 2.5;

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

/** A pinch may go a little past the limits (rubber band); the release settles back inside. */
export function rubberScale(scale: number): number {
  if (scale < MIN_SCALE) return MIN_SCALE - (MIN_SCALE - scale) * 0.4;
  if (scale > MAX_SCALE) return MAX_SCALE + (scale - MAX_SCALE) * 0.2;
  return scale;
}

/**
 * Zooms around a focal point (relative to the stage centre): the point under the fingers stays under the fingers.
 *
 * @param focus - focal point, px from the stage centre.
 */
export function zoomAround(state: ZoomState, nextScale: number, focus: { x: number; y: number }): ZoomState {
  const ratio = nextScale / state.scale;
  return {
    scale: nextScale,
    x: focus.x - (focus.x - state.x) * ratio,
    y: focus.y - (focus.y - state.y) * ratio,
  };
}

/**
 * Keeps the image covering what it can: at most it can move until its edge meets the stage edge; an image smaller
 * than the stage in one direction stays centred in that direction.
 *
 * @param content - the image's displayed size at scale 1.
 */
export function clampPan(state: ZoomState, stage: Size, content: Size): ZoomState {
  const limitX = Math.max(0, (content.width * state.scale - stage.width) / 2);
  const limitY = Math.max(0, (content.height * state.scale - stage.height) / 2);
  return {
    scale: state.scale,
    x: Math.min(limitX, Math.max(-limitX, state.x)),
    y: Math.min(limitY, Math.max(-limitY, state.y)),
  };
}

/** Where a release settles: scale inside the limits, pan clamped (scale 1 → centred). */
export function settle(state: ZoomState, stage: Size, content: Size): ZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale));
  if (scale === MIN_SCALE) return IDENTITY;
  return clampPan({ ...state, scale }, stage, content);
}

/** Double-tap: zoom in to {@link DOUBLE_TAP_SCALE} around the tap, or back out to 1. */
export function doubleTap(state: ZoomState, focus: { x: number; y: number }, stage: Size, content: Size): ZoomState {
  if (state.scale > MIN_SCALE + 0.01) return IDENTITY;
  return clampPan(zoomAround(state, DOUBLE_TAP_SCALE, focus), stage, content);
}

/** The image's displayed size at scale 1: fitted inside the stage, aspect ratio kept. */
export function fitInside(natural: Size, stage: Size): Size {
  if (natural.width <= 0 || natural.height <= 0) return stage;
  const ratio = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}
