// Location check-in rules (spec §5.1). The client reports a reading; the
// server recomputes distance and decides. Nothing here proves physical presence.

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface PositionReading extends LatLng {
  accuracyMeters: number;
  capturedAt: Date;
}

export interface LocationRules {
  maxAccuracyMeters: number;
  maxReadingAgeSeconds: number;
  maxClockSkewSeconds: number;
}

export const DEFAULT_LOCATION_RULES: LocationRules = {
  maxAccuracyMeters: 50,
  maxReadingAgeSeconds: 60,
  maxClockSkewSeconds: 30,
};

export const DEFAULT_PLACE_RADIUS_METERS = 100;

export type LocationVerdict =
  | { ok: true; code: "IN_RANGE"; distanceMeters: number }
  | {
      ok: false;
      code:
        | "LOCATION_INVALID"
        | "LOCATION_STALE"
        | "LOCATION_CLOCK_AHEAD"
        | "LOCATION_INACCURATE"
        | "LOCATION_NEAR_BOUNDARY"
        | "LOCATION_OUT_OF_RANGE";
      distanceMeters: number | null;
    };

const EARTH_RADIUS_METERS = 6_371_008.8;

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= -90 &&
    p.latitude <= 90 &&
    p.longitude >= -180 &&
    p.longitude <= 180
  );
}

/** Great-circle distance in meters. PostGIS is used for queries; this mirrors it for rules and tests. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function evaluateLocationReading(input: {
  reading: PositionReading;
  place: LatLng & { radiusMeters: number };
  now: Date;
  rules?: LocationRules;
}): LocationVerdict {
  const rules = input.rules ?? DEFAULT_LOCATION_RULES;
  const { reading, place, now } = input;

  if (!isValidLatLng(reading) || !Number.isFinite(reading.accuracyMeters) || reading.accuracyMeters < 0) {
    return { ok: false, code: "LOCATION_INVALID", distanceMeters: null };
  }
  const ageSeconds = (now.getTime() - reading.capturedAt.getTime()) / 1000;
  if (Number.isNaN(ageSeconds)) {
    return { ok: false, code: "LOCATION_INVALID", distanceMeters: null };
  }
  if (ageSeconds < -rules.maxClockSkewSeconds) {
    return { ok: false, code: "LOCATION_CLOCK_AHEAD", distanceMeters: null };
  }
  if (ageSeconds > rules.maxReadingAgeSeconds) {
    return { ok: false, code: "LOCATION_STALE", distanceMeters: null };
  }

  const distanceMeters = Math.round(haversineMeters(reading, place) * 10) / 10;

  if (reading.accuracyMeters > rules.maxAccuracyMeters) {
    return { ok: false, code: "LOCATION_INACCURATE", distanceMeters };
  }
  if (distanceMeters <= place.radiusMeters) {
    return { ok: true, code: "IN_RANGE", distanceMeters };
  }
  if (distanceMeters - reading.accuracyMeters <= place.radiusMeters) {
    return { ok: false, code: "LOCATION_NEAR_BOUNDARY", distanceMeters };
  }
  return { ok: false, code: "LOCATION_OUT_OF_RANGE", distanceMeters };
}
