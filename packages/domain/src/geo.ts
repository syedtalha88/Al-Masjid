// Coordinates typed or pasted by the Super Admin (PHASE_01 T1.11, C2): plain "lat, lng" or a Google Maps URL —
// `@lat,lng,zoom`, `q=` / `query=` / `ll=` / `destination=` parameters, or the `!3d<lat>!4d<lng>` place form.
// Short links (maps.app.goo.gl) carry no coordinates and are not resolved (that would need a network call).

export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^\s*(${NUMBER})\s*[,\s]\s*(${NUMBER})\s*$`);

function valid(lat: number, lng: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function pair(text: string): Coordinates | null {
  const match = PAIR.exec(text);
  return match ? valid(Number(match[1]), Number(match[2])) : null;
}

/**
 * Extracts coordinates from "17.3850, 78.4867" or a Google Maps URL.
 *
 * @returns the coordinates (not yet checked against India's bounds — the caller does that), or `null` when the text
 *   holds none (including short links).
 */
export function parseCoordinates(input: string): Coordinates | null {
  const text = input.trim();
  const plain = pair(text);
  if (plain) return plain;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // Place form first: it is the pin itself, while `@…` is only the map's centre.
  const place = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`).exec(url.pathname + url.search);
  if (place) return valid(Number(place[1]), Number(place[2]));
  for (const name of ['q', 'query', 'll', 'destination']) {
    const value = url.searchParams.get(name);
    const found = value ? pair(value) : null;
    if (found) return found;
  }
  const at = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`).exec(url.pathname);
  return at ? valid(Number(at[1]), Number(at[2])) : null;
}
