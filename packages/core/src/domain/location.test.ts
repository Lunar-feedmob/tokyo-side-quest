import { describe, expect, it } from "vitest";
import { evaluateLocationReading, haversineMeters } from "./location";

// Arbitrary test origin; not a real check-in point.
const place = { latitude: 35.0, longitude: 139.0, radiusMeters: 100 };
const now = new Date("2026-10-23T06:00:00Z");
// ~1 m of latitude in degrees.
const M = 1 / 111_195;

function reading(metersNorth: number, accuracyMeters = 10, ageSeconds = 5) {
  return {
    latitude: place.latitude + metersNorth * M,
    longitude: place.longitude,
    accuracyMeters,
    capturedAt: new Date(now.getTime() - ageSeconds * 1000),
  };
}

describe("evaluateLocationReading (R07–R09)", () => {
  it("passes exactly on the radius (≤ rule)", () => {
    const r = reading(100);
    const d = Math.round(haversineMeters(r, place) * 10) / 10;
    const result = evaluateLocationReading({
      reading: r,
      place: { ...place, radiusMeters: d },
      now,
    });
    expect(result).toMatchObject({ ok: true, code: "IN_RANGE" });
  });

  it("passes inside the radius", () => {
    expect(evaluateLocationReading({ reading: reading(40), place, now }).code).toBe("IN_RANGE");
  });

  it("rejects poor accuracy even when close (R08)", () => {
    expect(evaluateLocationReading({ reading: reading(10, 60), place, now }).code).toBe("LOCATION_INACCURATE");
  });

  it("reports near-boundary instead of widening the radius", () => {
    expect(evaluateLocationReading({ reading: reading(130, 40), place, now }).code).toBe("LOCATION_NEAR_BOUNDARY");
  });

  it("rejects out of range", () => {
    expect(evaluateLocationReading({ reading: reading(400, 10), place, now })).toMatchObject({
      ok: false,
      code: "LOCATION_OUT_OF_RANGE",
    });
  });

  it("rejects stale readings (R09)", () => {
    expect(evaluateLocationReading({ reading: reading(10, 10, 61), place, now }).code).toBe("LOCATION_STALE");
  });

  it("rejects readings from a clock far ahead", () => {
    expect(evaluateLocationReading({ reading: reading(10, 10, -31), place, now }).code).toBe(
      "LOCATION_CLOCK_AHEAD",
    );
    expect(evaluateLocationReading({ reading: reading(10, 10, -20), place, now }).code).toBe("IN_RANGE");
  });

  it("rejects invalid coordinates (R09)", () => {
    const bad = { ...reading(0), latitude: 139.0, longitude: 35.0 }; // swapped → latitude out of range
    expect(evaluateLocationReading({ reading: bad, place, now }).code).toBe("LOCATION_INVALID");
    expect(
      evaluateLocationReading({ reading: { ...reading(0), longitude: Number.NaN }, place, now }).code,
    ).toBe("LOCATION_INVALID");
  });

  it("swapped-but-valid coordinates land far away and fail", () => {
    // Both values inside valid ranges once swapped for a place near (35, 35)
    const p = { latitude: 35.0, longitude: 36.0, radiusMeters: 100 };
    const r = { latitude: 36.0, longitude: 35.0, accuracyMeters: 5, capturedAt: now };
    expect(evaluateLocationReading({ reading: r, place: p, now }).code).toBe("LOCATION_OUT_OF_RANGE");
  });
});
