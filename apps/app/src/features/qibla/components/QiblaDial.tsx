// A14 compass (07 A14, 08 §5.9, PHASE_07 T7.3): an SVG dial — ticks every 5°, N / E / S / W in Latin (never
// mirrored: SVG coordinates do not flip in RTL), the Kaaba marker at the Qibla bearing and the arrow from the centre to it.
// The whole dial turns with the phone (−heading) straight from the heading value — no React render per reading; a
// fixed indicator at the top shows where the phone points. Aligned (±3°): ring and arrow in primary-500 with a soft
// pulse (none with reduced motion).
import { memo, useEffect, useRef } from 'react';

import type { HeadingValue } from '../lib/heading.ts';

const SIZE = 300;
const C = SIZE / 2;
const RING = 132;
const TICKS = Array.from({ length: 72 }, (_, index) => index * 5);
const LETTERS = [
  { text: 'N', angle: 0 },
  { text: 'E', angle: 90 },
  { text: 'S', angle: 180 },
  { text: 'W', angle: 270 },
] as const;

/** A point at `radius` from the centre, `angle` degrees clockwise from the top. */
const at = (angle: number, radius: number) => {
  const r = (angle * Math.PI) / 180;
  return { x: C + radius * Math.sin(r), y: C - radius * Math.cos(r) };
};

export interface QiblaDialProps {
  readonly bearing: number;
  /** The phone's heading; `null` = no compass: the dial stays North-up. */
  readonly heading: HeadingValue | null;
  readonly aligned: boolean;
  /** Spoken name of the dial ("Compass: the Kaaba is 283° from North"). */
  readonly label: string;
}

export function QiblaDial({ bearing, heading, aligned, label }: QiblaDialProps) {
  const dial = useRef<SVGGElement>(null);

  useEffect(() => {
    const node = dial.current;
    if (!node) return;
    const turn = (value: number) => {
      node.style.transform = `rotate(${String(-value)}deg)`;
    };
    if (!heading) {
      turn(0);
      return;
    }
    turn(heading.get());
    return heading.on('change', turn);
  }, [heading]);

  // Letters (r 88) and the Kaaba (r 114) never meet — Indian bearings (256°–294°) sit right next to W.
  const tip = at(bearing, 74);
  const marker = at(bearing, RING - 18);
  const ringTone = aligned ? 'stroke-primary-500' : 'stroke-border';
  const arrowTone = aligned ? 'fill-primary-500 stroke-primary-500' : 'fill-primary-700 stroke-primary-700';

  return (
    <svg
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      className="mx-auto block w-full max-w-[320px]"
      role="img"
      aria-label={label}
      data-qibla-dial
      data-aligned={aligned ? 'true' : 'false'}
    >
      {/* Always in the DOM: aligning toggles paint (opacity + the pulse), never layout (08 §8). */}
      <circle
        cx={C}
        cy={C}
        r={RING + 8}
        className={`fill-none stroke-primary-500 ${aligned ? 'pulse-dot opacity-40' : 'opacity-0'}`}
        strokeWidth={8}
      />

      {/* The fixed indicator: where the top of the phone points. */}
      <path d={`M ${String(C)} 6 l -9 14 h 18 Z`} className={aligned ? 'fill-primary-500' : 'fill-text'} />
      <g ref={dial} style={{ transformOrigin: `${String(C)}px ${String(C)}px`, transformBox: 'view-box' }}>
        <circle cx={C} cy={C} r={RING} className={`fill-surface ${ringTone}`} strokeWidth={3} />
        <DialFace />
        <line x1={C} y1={C} x2={tip.x} y2={tip.y} className={arrowTone} strokeWidth={6} strokeLinecap="round" />
        <circle cx={C} cy={C} r={7} className={arrowTone} />
        {/* The Kaaba: a small dark cube with its gold band. */}
        <g transform={`translate(${String(marker.x)} ${String(marker.y)}) rotate(${String(bearing)})`} data-kaaba>
          <rect x={-11} y={-11} width={22} height={22} rx={3} className="fill-text" />
          <rect x={-11} y={-5} width={22} height={4} className="fill-sun" />
        </g>
      </g>
    </svg>
  );
}

/** Ticks and letters — static, rendered once (an alignment change repaints colours, not 76 elements). */
const DialFace = memo(function DialFace() {
  return (
    <>
      {TICKS.map((angle) => {
        const long = angle % 30 === 0;
        const from = at(angle, RING - 2);
        const to = at(angle, RING - (angle % 90 === 0 ? 16 : long ? 11 : 6));
        return (
          <line
            key={angle}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className={long ? 'stroke-text-secondary' : 'stroke-border'}
            strokeWidth={long ? 2 : 1}
          />
        );
      })}
      {LETTERS.map(({ text, angle }) => {
        const point = at(angle, RING - 44);
        return (
          <text
            key={text}
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="central"
            className={`type-headline ${text === 'N' ? 'fill-danger' : 'fill-text-secondary'}`}
            transform={`rotate(${String(angle)} ${String(point.x)} ${String(point.y)})`}
          >
            {text}
          </text>
        );
      })}
    </>
  );
});
