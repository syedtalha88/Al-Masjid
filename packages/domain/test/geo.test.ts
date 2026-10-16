import { describe, expect, it } from 'vitest';

import { parseCoordinates } from '../src/geo.ts';

describe('parseCoordinates (C2 coordinates input)', () => {
  it('reads plain pairs', () => {
    expect(parseCoordinates('17.3850, 78.4867')).toEqual({ lat: 17.385, lng: 78.4867 });
    expect(parseCoordinates(' 17.385 78.4867 ')).toEqual({ lat: 17.385, lng: 78.4867 });
    expect(parseCoordinates('17,78')).toEqual({ lat: 17, lng: 78 });
  });

  it('reads Google Maps URL forms, preferring the pin over the map centre', () => {
    expect(parseCoordinates('https://www.google.com/maps/@17.3850,78.4867,17z')).toEqual({ lat: 17.385, lng: 78.4867 });
    expect(parseCoordinates('https://maps.google.com/?q=17.39,78.47')).toEqual({ lat: 17.39, lng: 78.47 });
    expect(parseCoordinates('https://www.google.com/maps/search/?api=1&query=17.4%2C78.5')).toEqual({
      lat: 17.4,
      lng: 78.5,
    });
    expect(parseCoordinates('https://maps.google.com/maps?ll=12.97,77.59&z=15')).toEqual({ lat: 12.97, lng: 77.59 });
    expect(parseCoordinates('https://www.google.com/maps/dir/?api=1&destination=13.08,80.27')).toEqual({
      lat: 13.08,
      lng: 80.27,
    });
    expect(
      parseCoordinates(
        'https://www.google.com/maps/place/Some+Place/@17.40,78.40,15z/data=!3m1!4b1!4m6!3d17.4123!4d78.4456',
      ),
    ).toEqual({ lat: 17.4123, lng: 78.4456 });
  });

  it('returns null for text without coordinates, short links and impossible values', () => {
    expect(parseCoordinates('Tolichowki, Hyderabad')).toBeNull();
    expect(parseCoordinates('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(parseCoordinates('95, 78')).toBeNull();
    expect(parseCoordinates('17, 200')).toBeNull();
    expect(parseCoordinates('')).toBeNull();
  });
});
