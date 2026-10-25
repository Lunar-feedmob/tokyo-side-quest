import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { places, placeSurveyEntries } from "../db/schema";
import { haversineMeters } from "../domain/location";
import { AppError } from "../http/errors";
import { audit, type AdminPrincipal } from "./admin-auth";

// Field survey (content provenance "待办（需实地）"): an admin standing at a
// place records GPS samples and observations from the admin console on a
// phone. Coordinates and radii are then updated by hand and re-published;
// these rows never change what visitors see on their own.

export const SURVEY_POSITION_LABELS = ["checkpoint", "entrance", "edge", "other"] as const;

export const surveyEntryInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("position"),
    label: z.enum(SURVEY_POSITION_LABELS),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().positive().max(10_000),
    readings: z.number().int().min(1).max(10_000),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    kind: z.literal("note"),
    note: z.string().trim().min(1, "请填写现场记录").max(2000),
  }),
]);
export type SurveyEntryInput = z.infer<typeof surveyEntryInputSchema>;

async function placePoint(placeId: string) {
  const [p] = await db()
    .select({
      id: places.id,
      radiusM: places.radiusM,
      latitude: sql<number>`ST_Y(${places.geo}::geometry)`.mapWith(Number),
      longitude: sql<number>`ST_X(${places.geo}::geometry)`.mapWith(Number),
    })
    .from(places)
    .where(eq(places.id, placeId));
  if (!p) throw new AppError("NOT_FOUND", "地点不存在");
  return p;
}

export async function addSurveyEntry(admin: AdminPrincipal, placeId: string, input: SurveyEntryInput) {
  await placePoint(placeId);
  const values =
    input.kind === "position"
      ? { kind: "position", label: input.label, latitude: input.latitude, longitude: input.longitude, accuracyM: input.accuracyM, readings: input.readings, note: input.note || null }
      : { kind: "note", label: "note", note: input.note };
  const [row] = await db()
    .insert(placeSurveyEntries)
    .values({ placeId, adminId: admin.id, ...values })
    .returning({ id: placeSurveyEntries.id });
  // The audit trail records that a sample exists, not where the admin stood.
  await audit({ actorType: "admin", actorId: admin.id, action: "survey.add", targetType: "place", targetId: placeId, meta: { kind: input.kind, entryId: row!.id } });
  return listSurvey(placeId);
}

/** Entries for one place, each position with its distance from the current check-in point. */
export async function listSurvey(placeId: string) {
  const point = await placePoint(placeId);
  const rows = await db()
    .select()
    .from(placeSurveyEntries)
    .where(eq(placeSurveyEntries.placeId, placeId))
    .orderBy(asc(placeSurveyEntries.createdAt));
  return {
    point: { latitude: point.latitude, longitude: point.longitude, radiusM: point.radiusM },
    entries: rows.map((r) => {
      const distanceM =
        r.kind === "position" && r.latitude !== null && r.longitude !== null
          ? Math.round(haversineMeters(point, { latitude: r.latitude, longitude: r.longitude }))
          : null;
      return {
        id: r.id,
        kind: r.kind as "position" | "note",
        label: r.label,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracyM: r.accuracyM,
        readings: r.readings,
        note: r.note,
        distanceM,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  };
}

export async function deleteSurveyEntry(admin: AdminPrincipal, placeId: string, entryId: string) {
  const [row] = await db()
    .delete(placeSurveyEntries)
    .where(and(eq(placeSurveyEntries.id, entryId), eq(placeSurveyEntries.placeId, placeId)))
    .returning({ id: placeSurveyEntries.id });
  if (!row) throw new AppError("NOT_FOUND", "记录不存在");
  await audit({ actorType: "admin", actorId: admin.id, action: "survey.delete", targetType: "place", targetId: placeId, meta: { entryId } });
  return listSurvey(placeId);
}
