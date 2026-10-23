import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  placeProgress,
  places,
  questRuns,
  quests,
  questSteps,
  questStepProgress,
  stampAwards,
} from "../db/schema";
import { proofPolicyAllows, type CheckinMethod, type Mode } from "../domain/status";
import { AppError } from "../http/errors";

// Effects of an accepted check-in. Every write is guarded by a unique
// constraint so duplicate deliveries cannot double-award (spec §9.3 item 6).

export interface QuestContext {
  questRunId: string | null;
  questStepId: string | null;
}

export interface CheckinEffects {
  stampsAwarded: string[];
  questStepCompleted: boolean;
  questCompleted: boolean;
  questNote: string | null;
}

/**
 * Validates that a quest step can be advanced by this check-in. Used both
 * when an attempt is created and again when it is applied.
 */
export async function validateQuestContext(
  tx: DbOrTx,
  opts: { visitorId: string; mode: Mode; placeId: string; method: CheckinMethod; lock?: boolean } & QuestContext,
) {
  if (!opts.questRunId || !opts.questStepId) return null;
  const runQuery = tx
    .select()
    .from(questRuns)
    .where(and(eq(questRuns.id, opts.questRunId), eq(questRuns.visitorId, opts.visitorId), eq(questRuns.mode, opts.mode)))
    .limit(1);
  const [run] = opts.lock ? await runQuery.for("update") : await runQuery;
  if (!run) throw new AppError("NOT_FOUND", "没有找到这次故事探索");
  if (run.status !== "active") {
    throw new AppError("QUEST_STEP_MISMATCH", "这次故事探索不在进行中，请先恢复探索");
  }
  const [step] = await tx
    .select()
    .from(questSteps)
    .where(and(eq(questSteps.id, opts.questStepId), eq(questSteps.questVersionId, run.questVersionId)))
    .limit(1);
  if (!step) throw new AppError("QUEST_STEP_MISMATCH", "任务节点不属于这次故事探索");
  if (step.placeId !== opts.placeId) throw new AppError("QUEST_STEP_MISMATCH", "这个任务节点对应的是另一个地点");
  if (!proofPolicyAllows(step.proofPolicy, opts.method)) {
    throw new AppError(
      "QUEST_STEP_MISMATCH",
      step.proofPolicy === "location" ? "这个任务节点需要定位打卡" : "这个任务节点需要拍照打卡",
    );
  }
  return { run, step };
}

export async function applyCheckinEffects(
  tx: DbOrTx,
  opts: { visitorId: string; mode: Mode; placeId: string; checkinId: string; method: CheckinMethod } & QuestContext,
): Promise<CheckinEffects> {
  const effects: CheckinEffects = { stampsAwarded: [], questStepCompleted: false, questCompleted: false, questNote: null };

  await tx
    .insert(placeProgress)
    .values({ visitorId: opts.visitorId, placeId: opts.placeId, mode: opts.mode, firstCheckinId: opts.checkinId })
    .onConflictDoUpdate({
      target: [placeProgress.visitorId, placeProgress.placeId, placeProgress.mode],
      set: {
        firstCheckinId: sql`coalesce(${placeProgress.firstCheckinId}, excluded.first_checkin_id)`,
        updatedAt: sql`now()`,
      },
    });

  const [place] = await tx.select({ slug: places.slug }).from(places).where(eq(places.id, opts.placeId));
  const placeStamp = `place:${place!.slug}`;
  const placeAward = await tx
    .insert(stampAwards)
    .values({ visitorId: opts.visitorId, mode: opts.mode, stampKey: placeStamp, kind: "place", sourceId: opts.checkinId })
    .onConflictDoNothing()
    .returning({ id: stampAwards.id });
  if (placeAward.length > 0) effects.stampsAwarded.push(placeStamp);

  if (!opts.questRunId || !opts.questStepId) return effects;

  let ctx: Awaited<ReturnType<typeof validateQuestContext>>;
  try {
    ctx = await validateQuestContext(tx, { ...opts, lock: true });
  } catch (error) {
    // The check-in itself stands; only the quest step is not advanced.
    if (error instanceof AppError) {
      effects.questNote = error.message;
      return effects;
    }
    throw error;
  }
  if (!ctx) return effects;

  const progressed = await tx
    .insert(questStepProgress)
    .values({ runId: ctx.run.id, stepId: ctx.step.id, checkinId: opts.checkinId })
    .onConflictDoNothing()
    .returning({ id: questStepProgress.id });
  effects.questStepCompleted = progressed.length > 0;

  const [counts] = await tx
    .select({
      required: sql<number>`count(*) filter (where ${questSteps.required})`.mapWith(Number),
      done: sql<number>`count(${questStepProgress.id}) filter (where ${questSteps.required})`.mapWith(Number),
    })
    .from(questSteps)
    .leftJoin(
      questStepProgress,
      and(eq(questStepProgress.stepId, questSteps.id), eq(questStepProgress.runId, ctx.run.id)),
    )
    .where(eq(questSteps.questVersionId, ctx.run.questVersionId));

  if (counts && counts.required > 0 && counts.done >= counts.required) {
    const completed = await tx
      .update(questRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(questRuns.id, ctx.run.id), eq(questRuns.status, "active")))
      .returning({ id: questRuns.id });
    if (completed.length > 0) {
      effects.questCompleted = true;
      const [quest] = await tx.select({ slug: quests.slug }).from(quests).where(eq(quests.id, ctx.run.questId));
      const questStamp = `quest:${quest!.slug}`;
      const award = await tx
        .insert(stampAwards)
        .values({ visitorId: opts.visitorId, mode: opts.mode, stampKey: questStamp, kind: "quest", sourceId: ctx.run.id })
        .onConflictDoNothing()
        .returning({ id: stampAwards.id });
      if (award.length > 0) effects.stampsAwarded.push(questStamp);
    }
  }
  return effects;
}
