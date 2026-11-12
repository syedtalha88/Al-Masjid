import { qiblaBearing } from '@mc/domain/qibla';
import { describe, expect, it } from 'vitest';

import { roundCoordinates } from '../useQiblaLocation.ts';

// 05 §1 / security review L2 (Phase 07): the phone keeps its location only to ~1 km — enough for the direction.

describe('roundCoordinates', () => {
  it('keeps 2 decimals, both signs', () => {
    expect(roundCoordinates({ lat: 28.6139, lng: 77.209 })).toEqual({ lat: 28.61, lng: 77.21 });
    expect(roundCoordinates({ lat: -33.86785, lng: -151.20732 })).toEqual({ lat: -33.87, lng: -151.21 });
    expect(roundCoordinates({ lat: 8.0883, lng: 68.1 })).toEqual({ lat: 8.09, lng: 68.1 });
  });

  it('moves the Qibla bearing by under 0.05° across India', () => {
    const places = [
      { lat: 34.0837, lng: 74.7973 }, // Srinagar
      { lat: 8.0883, lng: 77.5385 }, // Kanyakumari
      { lat: 23.2156, lng: 68.9993 }, // Kutch
      { lat: 27.4728, lng: 94.912 }, // Dibrugarh
      { lat: 17.385, lng: 78.4867 }, // Hyderabad
    ];
    for (const at of places) {
      expect(Math.abs(qiblaBearing(roundCoordinates(at)) - qiblaBearing(at))).toBeLessThan(0.05);
    }
  });
});
