// Actions on a post (07 A7–A9): its share link (`/p/:publicId`, the A16 landing — no tracking parameters), the event
// calendar file ("Add to calendar" → .ics download) and copying the reader text.
import { buildIcsEvent } from '@mc/domain/ics';
import { BRAND } from '@mc/shared/brand';

/** The public link of a post (03 §3 `/p/:publicId`). */
export const itemLink = (origin: string, publicId: string): string =>
  `${origin.replace(/\/$/, '')}/p/${encodeURIComponent(publicId)}`;

/** PRODID must be printable ASCII; the brand name is, but never trust it to stay so. */
const prodId = () => `-//${BRAND.name.replace(/[^\x20-\x7e]/g, '')}//Notice//EN`;

export interface EventFile {
  readonly filename: string;
  readonly text: string;
}

/**
 * The calendar file of an event notice: one hour from `start`, titled like the card, with the masjid as location and
 * the post link.
 */
export function eventFile(input: {
  readonly publicId: string;
  readonly start: Date;
  readonly title: string;
  readonly body?: string | undefined;
  readonly masjid?: string | undefined;
  readonly origin: string;
  readonly now: Date;
}): EventFile {
  const host = new URL(input.origin).host;
  const text = buildIcsEvent({
    uid: `${input.publicId}@${host}`,
    start: input.start,
    title: input.title,
    ...(input.body ? { description: input.body } : {}),
    ...(input.masjid ? { location: input.masjid } : {}),
    url: itemLink(input.origin, input.publicId),
    now: input.now,
    prodId: prodId(),
  });
  return { filename: `event-${input.publicId}.ics`, text };
}

/** Saves a text file through a temporary object URL (works offline; nothing leaves the phone). */
export function downloadFile(file: EventFile, type = 'text/calendar;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([file.text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked after the browser has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
