import { env } from "../config/env";
import { db } from "../db/client";
import { checkins } from "../db/schema";
import { DEFAULT_LOCATION_RULES, evaluateLocationReading, type LocationVerdict } from "../domain/location";
import type { Mode } from "../domain/status";
import type { PositionInput } from "../contracts/api";
import { AppError, LOCATION_MESSAGES } from "../http/errors";
import { loadCheckinPlace } from "./places";
import { applyCheckinEffects, validateQuestContext, type CheckinEffects, type QuestContext } from "./rewards";

// Location check-in (spec §5.1). The server recomputes distance from the
// stored place point; client-supplied distance or "passed" flags do not exist
// in the request schema at all.

export interface LocationCheckinResult {
  checkin: {
    id: string;
    placeId: string;
    method: "location";
    arrivalVerified: true;
    distanceMeters: number;
    accuracyMeters: number;
    simulated: boolean;
    acceptedAt: Date;
  };
  label: string;
  effects: CheckinEffects;
}

export function evaluatePosition(
  position: PositionInput,
  place: { latitude: number; longitude: number; radiusMeters: number },
): LocationVerdict {
  return evaluateLocationReading({
    reading: {
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracyMeters,
      capturedAt: new Date(position.capturedAt),
    },
    place,
    now: new Date(),
    rules: DEFAULT_LOCATION_RULES,
  });
}

export async function locationCheckin(opts: {
  visitorId: string;
  mode: Mode;
  placeId: string;
  position: PositionInput;
  simulated: boolean;
} & QuestContext): Promise<LocationCheckinResult> {
  if (opts.simulated && !(env().DEV_SIMULATED_LOCATION || opts.mode === "demo")) {
    throw new AppError("FORBIDDEN", "当前环境未启用模拟定位");
  }

  return db().transaction(async (tx) => {
    const place = await loadCheckinPlace(tx, opts.placeId);
    await validateQuestContext(tx, { ...opts, method: "location" });

    const verdict = evaluatePosition(opts.position, place);
    if (!verdict.ok) {
      throw new AppError(verdict.code, LOCATION_MESSAGES[verdict.code] ?? "定位不符合打卡条件", {
        distanceMeters: verdict.distanceMeters,
        accuracyMeters: opts.position.accuracyMeters,
        radiusMeters: place.radiusMeters,
        distanceType: "straight_line",
      });
    }

    const [checkin] = await tx
      .insert(checkins)
      .values({
        visitorId: opts.visitorId,
        mode: opts.mode,
        placeId: place.id,
        method: "location",
        arrivalVerified: true,
        distanceMeters: verdict.distanceMeters,
        accuracyMeters: opts.position.accuracyMeters,
        simulated: opts.simulated,
        rawLatitude: opts.position.latitude,
        rawLongitude: opts.position.longitude,
        questRunId: opts.questRunId,
        questStepId: opts.questStepId,
      })
      .returning();

    const effects = await applyCheckinEffects(tx, {
      visitorId: opts.visitorId,
      mode: opts.mode,
      placeId: place.id,
      checkinId: checkin!.id,
      method: "location",
      questRunId: opts.questRunId,
      questStepId: opts.questStepId,
    });

    return {
      checkin: {
        id: checkin!.id,
        placeId: place.id,
        method: "location",
        arrivalVerified: true,
        distanceMeters: verdict.distanceMeters,
        accuracyMeters: opts.position.accuracyMeters,
        simulated: opts.simulated,
        acceptedAt: checkin!.acceptedAt,
      },
      label: opts.simulated ? "位置符合范围 · 模拟定位" : "位置符合范围",
      effects,
    };
  });
}
