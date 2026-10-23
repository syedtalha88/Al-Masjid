// Horizontal card carousel (08 §4, ref-1 Home): native momentum + CSS scroll-snap, the next card peeks in by 16px,
// pagination dots follow the scroll position (the active dot stretches 6 → 18px via scaleX — transform only). RTL
// scrolls the other way natively; the index uses |scrollLeft| so it works in both directions.
import { Children, type ReactNode, useEffect, useRef, useState } from 'react';

export interface CarouselProps {
  /** Accessible name of the list, e.g. "My Masjids". */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Carousel({ label, children, className }: CarouselProps) {
  const items = Children.toArray(children);
  const scroller = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const node = scroller.current;
    if (!node || items.length < 2) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const first = node.firstElementChild;
      const second = first?.nextElementSibling;
      if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return;
      const step = Math.abs(second.offsetLeft - first.offsetLeft) || 1;
      setIndex(Math.min(Math.round(Math.abs(node.scrollLeft) / step), items.length - 1));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', onScroll);
    };
  }, [items.length]);

  const single = items.length < 2;
  return (
    <div className={`mx-bleed ${className ?? ''}`}>
      <ul
        ref={scroller}
        aria-label={label}
        className={`flex gap-3 px-screen ${single ? '' : 'scroller-x snap-x snap-mandatory scroll-px-screen'}`}
      >
        {items.map((item, position) => (
          <li
            // Children.toArray gives each child a stable key.
            key={position}
            className={`shrink-0 snap-start ${single ? 'w-full' : 'w-[calc(100%-1rem)]'}`}
          >
            {item}
          </li>
        ))}
      </ul>
      {single ? null : (
        <div aria-hidden data-carousel-dots className="mt-3 flex justify-center">
          {items.map((_, position) => (
            <span key={position} className="flex w-3.5 justify-center">
              <span
                className={`h-1.5 w-4.5 shrink-0 rounded-full transition-indicator ${
                  position === index ? 'scale-x-100 bg-primary-700' : 'scale-x-[0.3333] bg-border'
                }`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
