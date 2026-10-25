// iCalendar export of an event announcement (07 A7 "Add to calendar" → .ics download): one VEVENT per file, times in
// UTC, text escaped and lines folded per RFC 5545 so no user text can add or end a property. Pure — the app turns the
// string into a file.

/** RFC 5545 §3.1: lines longer than 75 octets are folded. */
const MAX_LINE_OCTETS = 75;
/** An event without an end time is shown as one hour long. */
const DEFAULT_LENGTH_MS = 60 * 60_000;

export interface IcsEvent {
  /** Globally unique and stable for the item (e.g. `<publicId>@<domain>`): calendars update instead of duplicating. */
  readonly uid: string;
  readonly start: Date;
  /** Default: `start` + 1 hour. */
  readonly end?: Date;
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly url?: string;
  /** DTSTAMP — when the file was made. */
  readonly now: Date;
  /** PRODID, e.g. `-//Masjid Connect//Item//EN`. */
  readonly prodId: string;
}

/**
 * Escapes a TEXT value (RFC 5545 §3.3.11): `\` `;` `,` and line breaks; tabs become spaces, other control characters
 * are dropped.
 */
export function escapeIcsText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ')
      // Control characters other than the line break (kept until the next step) are dropped.
      .replace(/[^\P{Cc}\n]/gu, '')
      .replace(/[\\;,]/g, (char) => `\\${char}`)
      .replace(/\n/g, '\\n')
  );
}

const encoder = new TextEncoder();

/**
 * Folds one content line at 75 octets (RFC 5545 §3.1): CRLF + one space, never splitting a UTF-8 character (or a
 * surrogate pair).
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts towards their 75 octets.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** `20261026T151500Z` (UTC, seconds dropped to whole seconds). */
function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

const isValidDate = (date: Date) => Number.isFinite(date.getTime());

/**
 * Builds a one-event iCalendar file.
 *
 * @returns the file text (CRLF line ends, trailing CRLF).
 * @throws RangeError for an invalid date, an end before the start, or a UID / PRODID with characters outside
 *   printable ASCII.
 */
export function buildIcsEvent(event: IcsEvent): string {
  const end = event.end ?? new Date(event.start.getTime() + DEFAULT_LENGTH_MS);
  if (!isValidDate(event.start) || !isValidDate(end) || !isValidDate(event.now)) {
    throw new RangeError('buildIcsEvent(): invalid date');
  }
  if (end.getTime() < event.start.getTime()) throw new RangeError('buildIcsEvent(): end before start');
  for (const value of [event.uid, event.prodId]) {
    if (!/^[\x21-\x7e][\x20-\x7e]*$/.test(value)) throw new RangeError('buildIcsEvent(): unsafe UID or PRODID');
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${event.prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsUtc(event.now)}`,
    `DTSTART:${icsUtc(event.start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    // A URI value is not TEXT-escaped; line breaks are removed so it stays one property.
    ...(event.url ? [`URL:${event.url.replace(/[\r\n]/g, '')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
