// Qibla (00 §4.5, 01 §5.7, DECISIONS #118, PHASE_07 T7.1): the direction of the Kaaba from where the musalli stands —
// the great-circle initial bearing, clockwise from true North — its distance, the phone's heading from a
// device-orientation event, and the small angle helpers the page needs. Pure: the location never leaves the phone
// (05 §1) and nothing here does I/O. Verified against two independent calculators (test/fixtures/qibla-golden.json).
import type { Coordinates } from './geo.ts';

/** The Kaaba (01 §5.7). */
export const KAABA: Coordinates = { lat: 21.4225, lng: 39.8262 };

/** Mean Earth radius (IUGG), km. */
const EARTH_RADIUS_KM = 6371.0088;
/** "Aligned" when the heading is within this many degrees of the bearing (07 A14). */
export const ALIGNED_DEGREES = 3;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** `degrees` wrapped into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  return positive === 360 || Object.is(positive, -0) ? 0 : positive;
}

/**
 * The Qibla: great-circle initial bearing from `from` to the Kaaba, degrees clockwise from true North.
 *
 * @returns a bearing in [0, 360); 0 at the Kaaba itself (no direction there).
 */
export function qiblaBearing(from: Coordinates): number {
  const φ1 = rad(from.lat);
  const φ2 = rad(KAABA.lat);
  const Δλ = rad(KAABA.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) return 0;
  return normalizeDegrees(deg(Math.atan2(y, x)));
}

/** Haversine distance from `from` to the Kaaba, km (spherical — within 1 % of the ellipsoid in India). */
export function distanceToKaabaKm(from: Coordinates): number {
  const φ1 = rad(from.lat);
  const φ2 = rad(KAABA.lat);
  const a =
    Math.sin(rad(KAABA.lat - from.lat) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(rad(KAABA.lng - from.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The signed shortest turn from `from` to `to`, degrees.
 *
 * @returns a value in (-180, 180] — positive is clockwise (359° → 1° is +2°).
 */
export function angleDelta(from: number, to: number): number {
  const delta = normalizeDegrees(to - from);
  return delta > 180 ? delta - 360 : delta;
}

/** Is `heading` within `tolerance` degrees of `bearing` (either side, across North)? */
export function isAligned(heading: number, bearing: number, tolerance = ALIGNED_DEGREES): boolean {
  return Math.abs(angleDelta(heading, bearing)) <= tolerance;
}

/** What a `deviceorientation(absolute)` event offers (the fields we read). */
export interface OrientationReading {
  readonly alpha: number | null;
  /** `deviceorientationabsolute`, or an event the browser marks absolute. */
  readonly absolute: boolean;
  /** iOS Safari only: degrees clockwise from magnetic North; −1 when unknown. */
  readonly webkitCompassHeading?: number | null | undefined;
}

/**
 * The phone's heading (clockwise from North) from one orientation event (01 §5.7).
 *
 * @param screenAngle - `screen.orientation.angle` (0, 90, 180, 270): the screen's rotation adds to the heading.
 * @param platform - iOS reads `webkitCompassHeading`; Android (and others) need an absolute `alpha`, which is
 *   counter-clockwise: heading = (360 − alpha + screenAngle) mod 360.
 * @returns the heading in [0, 360), or `null` when the event carries no absolute heading (no compass → the page
 *   shows the bearing in degrees).
 */
export function headingFromOrientation(
  event: OrientationReading,
  screenAngle: number,
  platform: 'ios' | 'android' | 'other',
): number | null {
  if (platform === 'ios') {
    const compass = event.webkitCompassHeading;
    if (typeof compass !== 'number' || !Number.isFinite(compass) || compass < 0) return null;
    return normalizeDegrees(compass + screenAngle);
  }
  if (!event.absolute || event.alpha === null || !Number.isFinite(event.alpha)) return null;
  return normalizeDegrees(360 - event.alpha + screenAngle);
}

/**
 * Exponential smoothing of a heading along the short way round (so 350° → 10° passes North, not South).
 *
 * @param previous - the smoothed heading so far (`null` → start at `next`).
 * @param factor - the share of the turn taken per reading, (0, 1]; 1 = no smoothing.
 * @throws RangeError for a factor outside (0, 1].
 */
export function smoothHeading(previous: number | null, next: number, factor: number): number {
  if (!(factor > 0 && factor <= 1)) throw new RangeError('smoothHeading(): factor must be in (0, 1]');
  if (previous === null) return normalizeDegrees(next);
  return normalizeDegrees(previous + angleDelta(previous, next) * factor);
}
