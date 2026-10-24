import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Data model (spec §8). All business keys are random UUIDs, timestamps are
// timestamptz stored in UTC, and every visitor-owned row carries `mode`.

/** geography(Point,4326). Read back via ST_Y/ST_X in queries; written with makePoint(). */
export const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const modeEnum = pgEnum("mode", ["live", "demo"]);
export const placeStatusEnum = pgEnum("place_status", ["draft", "published", "temporarily_closed", "archived"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "published", "archived"]);
export const proofPolicyEnum = pgEnum("proof_policy", ["location", "photo", "either"]);
export const questRunStatusEnum = pgEnum("quest_run_status", ["active", "ended_partial", "completed"]);
export const processingStatusEnum = pgEnum("processing_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const verificationStatusEnum = pgEnum("verification_status", [
  "pending",
  "matched",
  "uncertain",
  "mismatched",
  "error",
]);
export const ratingStatusEnum = pgEnum("rating_status", [
  "not_requested",
  "pending",
  "completed",
  "unscorable",
  "error",
]);
export const assetKindEnum = pgEnum("asset_kind", ["user_photo", "reference", "poster", "sample", "brand"]);
export const assetStateEnum = pgEnum("asset_state", ["ready", "deleting", "deleted"]);
export const checkinMethodEnum = pgEnum("checkin_method", ["location", "photo"]);
export const verificationSourceEnum = pgEnum("verification_source", ["ai", "human", "demo_sample"]);
export const reviewStatusEnum = pgEnum("review_status", ["open", "approved", "rejected", "cancelled"]);
export const posterStatusEnum = pgEnum("poster_status", ["queued", "rendering", "ready", "failed", "deleted"]);

// ── Identity ────────────────────────────────────────────────────────────────

export const visitors = pgTable("visitors", {
  id: id(),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_visitor_idx").on(t.visitorId)],
);

export const admins = pgTable(
  "admins",
  {
    id: id(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("editor"), // "owner" | "editor" | "reviewer"
    status: text("status").notNull().default("active"), // "active" | "disabled"
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("admins_username_key").on(t.username)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("admin_sessions_token_hash_key").on(t.tokenHash)],
);

// ── Content ─────────────────────────────────────────────────────────────────

export const neighborhoods = pgTable(
  "neighborhoods",
  {
    id: id(),
    slug: text("slug").notNull(),
    nameZh: text("name_zh").notNull(),
    nameJa: text("name_ja").notNull(),
    nameEn: text("name_en"),
    summary: text("summary").notNull().default(""),
    center: geography("center").notNull(),
    status: contentStatusEnum("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("neighborhoods_slug_key").on(t.slug)],
);

export const places = pgTable(
  "places",
  {
    id: id(),
    slug: text("slug").notNull(),
    neighborhoodId: uuid("neighborhood_id")
      .notNull()
      .references(() => neighborhoods.id),
    nameZh: text("name_zh").notNull(),
    nameJa: text("name_ja").notNull(),
    nameEn: text("name_en"),
    geo: geography("geo").notNull(),
    status: placeStatusEnum("status").notNull().default("draft"),
    radiusM: integer("radius_m").notNull().default(100),
    photoEnabled: boolean("photo_enabled").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    stayMinutes: integer("stay_minutes"),
    /** Latest published version; null until first publish. */
    publishedVersionId: uuid("published_version_id"),
    /** Editable draft fields, snapshotted into place_versions on publish. */
    draft: jsonb("draft").$type<PlaceContent>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("places_slug_key").on(t.slug),
    index("places_geo_gist").using("gist", t.geo),
    index("places_neighborhood_idx").on(t.neighborhoodId),
  ],
);

export interface SourceRef {
  label: string;
  url: string;
  accessedOn: string; // YYYY-MM-DD
  note?: string;
}

export interface PlaceContent {
  intro: string;
  cultureNote: string;
  cultureSources: SourceRef[];
  shootingTips: string;
  distinctiveFeatures: string[];
  confusablePlaces: string[];
  unsuitableAngles: string[];
  restrictions: { text: string; source?: SourceRef }[] | null; // null = 未知
  coordinateSource: SourceRef;
  verificationLevel: "desk" | "field";
  storyLink?: string;
}

export const placeVersions = pgTable(
  "place_versions",
  {
    id: id(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    version: integer("version").notNull(),
    nameZh: text("name_zh").notNull(),
    nameJa: text("name_ja").notNull(),
    nameEn: text("name_en"),
    content: jsonb("content").$type<PlaceContent>().notNull(),
    /** Snapshot of reference image ids used for photo verification. */
    referenceImageIds: jsonb("reference_image_ids").$type<string[]>().notNull().default([]),
    referenceVersion: text("reference_version").notNull(),
    photoEnabled: boolean("photo_enabled").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid("published_by"),
  },
  (t) => [uniqueIndex("place_versions_place_version_key").on(t.placeId, t.version)],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    kind: assetKindEnum("kind").notNull(),
    ownerVisitorId: uuid("owner_visitor_id").references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode"),
    objectKey: text("object_key").notNull(),
    thumbKey: text("thumb_key"),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    state: assetStateEnum("state").notNull().default("ready"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("assets_object_key_key").on(t.objectKey), index("assets_owner_idx").on(t.ownerVisitorId)],
);

export const referenceImages = pgTable(
  "reference_images",
  {
    id: id(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    viewNote: text("view_note").notNull(),
    sourceUrl: text("source_url").notNull(),
    author: text("author").notNull(),
    license: text("license").notNull(),
    usageBasis: text("usage_basis").notNull(),
    publicDisplay: boolean("public_display").notNull().default(false),
    capturedOn: text("captured_on"),
    status: text("status").notNull().default("active"), // "active" | "retired" (never hard-deleted while referenced)
    createdAt: createdAt(),
  },
  (t) => [index("reference_images_place_idx").on(t.placeId)],
);

export const quests = pgTable(
  "quests",
  {
    id: id(),
    slug: text("slug").notNull(),
    neighborhoodId: uuid("neighborhood_id")
      .notNull()
      .references(() => neighborhoods.id),
    status: contentStatusEnum("status").notNull().default("draft"),
    publishedVersionId: uuid("published_version_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quests_slug_key").on(t.slug)],
);

export const questVersions = pgTable(
  "quest_versions",
  {
    id: id(),
    questId: uuid("quest_id")
      .notNull()
      .references(() => quests.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    intro: text("intro").notNull(),
    ending: text("ending").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    fictionNote: text("fiction_note").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quest_versions_quest_version_key").on(t.questId, t.version)],
);

export const questSteps = pgTable(
  "quest_steps",
  {
    id: id(),
    questVersionId: uuid("quest_version_id")
      .notNull()
      .references(() => questVersions.id),
    position: integer("position").notNull(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    proofPolicy: proofPolicyEnum("proof_policy").notNull().default("either"),
    required: boolean("required").notNull().default(true),
    title: text("title").notNull(),
    story: text("story").notNull(),
    objective: text("objective").notNull(),
    clue: text("clue").notNull(),
    observationQuestion: text("observation_question").notNull(),
    completionText: text("completion_text").notNull(),
  },
  (t) => [uniqueIndex("quest_steps_version_position_key").on(t.questVersionId, t.position)],
);

// ── Play state ──────────────────────────────────────────────────────────────

export const questRuns = pgTable(
  "quest_runs",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    questId: uuid("quest_id")
      .notNull()
      .references(() => quests.id),
    questVersionId: uuid("quest_version_id")
      .notNull()
      .references(() => questVersions.id),
    mode: modeEnum("mode").notNull(),
    status: questRunStatusEnum("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("quest_runs_one_active_key")
      .on(t.visitorId, t.questId, t.mode)
      .where(sql`${t.status} = 'active'`),
    index("quest_runs_visitor_idx").on(t.visitorId, t.mode),
  ],
);

export const photoEvaluations = pgTable(
  "photo_evaluations",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    placeVersionId: uuid("place_version_id")
      .notNull()
      .references(() => placeVersions.id),
    imageSha256: text("image_sha256").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelConfigVersion: text("model_config_version").notNull(),
    verifyPromptVersion: text("verify_prompt_version").notNull(),
    ratingPromptVersion: text("rating_prompt_version").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    referenceVersion: text("reference_version").notNull(),
    cacheKey: text("cache_key").notNull(),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("pending"),
    verification: jsonb("verification").$type<Record<string, unknown>>(),
    ratingStatus: ratingStatusEnum("rating_status").notNull().default("not_requested"),
    rating: jsonb("rating").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("photo_evaluations_cache_key").on(t.cacheKey)],
);

export const photoAttempts = pgTable(
  "photo_attempts",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    placeVersionId: uuid("place_version_id")
      .notNull()
      .references(() => placeVersions.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => photoEvaluations.id),
    contextKey: text("context_key").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    questRunId: uuid("quest_run_id").references(() => questRuns.id, { onDelete: "set null" }),
    questStepId: uuid("quest_step_id").references(() => questSteps.id),
    /** Optional location evidence the user chose to attach. Only the server's verdict is stored. */
    locationEvidence: jsonb("location_evidence").$type<LocationEvidence>(),
    sampleKey: text("sample_key"),
    processingStatus: processingStatusEnum("processing_status").notNull().default("queued"),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("pending"),
    ratingStatus: ratingStatusEnum("rating_status").notNull().default("not_requested"),
    errorCode: text("error_code"),
    errorStage: text("error_stage"),
    retryCount: integer("retry_count").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("photo_attempts_dedupe_key").on(t.dedupeKey),
    index("photo_attempts_visitor_idx").on(t.visitorId, t.mode, t.createdAt),
  ],
);

export interface LocationEvidence {
  verdict: string;
  distanceMeters: number | null;
  accuracyMeters: number;
  arrivalVerified: boolean;
  simulated: boolean;
}

export const placeVerifications = pgTable(
  "place_verifications",
  {
    id: id(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => photoAttempts.id, { onDelete: "cascade" }),
    source: verificationSourceEnum("source").notNull(),
    verdict: text("verdict").notNull(), // matched | uncertain | mismatched
    reasonCode: text("reason_code"),
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    userMessage: text("user_message").notNull(),
    reshootSuggestion: text("reshoot_suggestion"),
    reviewerId: uuid("reviewer_id"),
    reviewReason: text("review_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("place_verifications_attempt_idx").on(t.attemptId)],
);

export const photoRatings = pgTable(
  "photo_ratings",
  {
    id: id(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => photoAttempts.id, { onDelete: "cascade" }),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    composition: integer("composition").notNull(),
    lighting: integer("lighting").notNull(),
    clarity: integer("clarity").notNull(),
    expression: integer("expression").notNull(),
    total: integer("total").notNull(),
    grade: text("grade").notNull(),
    strength: text("strength").notNull(),
    improvement: text("improvement").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("photo_ratings_attempt_key").on(t.attemptId),
    index("photo_ratings_best_idx").on(t.visitorId, t.mode, t.placeId, t.rubricVersion),
  ],
);

export const checkins = pgTable(
  "checkins",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    method: checkinMethodEnum("method").notNull(),
    attemptId: uuid("attempt_id").references(() => photoAttempts.id, { onDelete: "cascade" }),
    /** Device location satisfied the rules (spec §5.2 wording, not proof of presence). */
    arrivalVerified: boolean("arrival_verified").notNull(),
    distanceMeters: real("distance_meters"),
    accuracyMeters: real("accuracy_meters"),
    simulated: boolean("simulated").notNull().default(false),
    /** Raw reading kept briefly for diagnosing misjudgements, then purged. */
    rawLatitude: doublePrecision("raw_latitude"),
    rawLongitude: doublePrecision("raw_longitude"),
    rawPurgedAt: timestamp("raw_purged_at", { withTimezone: true }),
    questRunId: uuid("quest_run_id").references(() => questRuns.id, { onDelete: "set null" }),
    questStepId: uuid("quest_step_id").references(() => questSteps.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("checkins_attempt_key").on(t.attemptId),
    index("checkins_visitor_idx").on(t.visitorId, t.mode, t.acceptedAt),
  ],
);

export const questStepProgress = pgTable(
  "quest_step_progress",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => questRuns.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => questSteps.id),
    checkinId: uuid("checkin_id")
      .notNull()
      .references(() => checkins.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quest_step_progress_run_step_key").on(t.runId, t.stepId)],
);

export const placeProgress = pgTable(
  "place_progress",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    mode: modeEnum("mode").notNull(),
    firstCheckinId: uuid("first_checkin_id").references(() => checkins.id, { onDelete: "set null" }),
    bestRatingId: uuid("best_rating_id").references(() => photoRatings.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("place_progress_visitor_place_mode_key").on(t.visitorId, t.placeId, t.mode)],
);

export const stampAwards = pgTable(
  "stamp_awards",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    stampKey: text("stamp_key").notNull(), // place:<slug> | quest:<slug>
    kind: text("kind").notNull(), // place | quest
    sourceId: uuid("source_id").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stamp_awards_visitor_mode_key").on(t.visitorId, t.mode, t.stampKey)],
);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: id(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => photoAttempts.id, { onDelete: "cascade" }),
    status: reviewStatusEnum("status").notNull().default("open"),
    note: text("note"),
    reviewerId: uuid("reviewer_id").references(() => admins.id),
    reason: text("reason"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("review_requests_one_open_key")
      .on(t.attemptId)
      .where(sql`${t.status} = 'open'`),
  ],
);

export interface PosterSnapshot {
  templateVersion: string;
  mode: "live" | "demo";
  kind: "place" | "quest";
  title: string;
  subtitle: string;
  nameJa: string | null;
  dateTokyo: string;
  caption: string | null;
  grade: string | null;
  stamps: string[];
  questCompleted: boolean | null;
  coverAssetId: string | null;
  coverAttemptId: string | null;
}

export const posters = pgTable(
  "posters",
  {
    id: id(),
    ownerVisitorId: uuid("owner_visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    mode: modeEnum("mode").notNull(),
    templateVersion: text("template_version").notNull(),
    snapshot: jsonb("snapshot").$type<PosterSnapshot>().notNull(),
    /** Rendered PNG; replaced when a share QR code is added. */
    assetId: uuid("asset_id").references(() => assets.id),
    renderedWithShareId: uuid("rendered_with_share_id"),
    status: posterStatusEnum("status").notNull().default("queued"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("posters_owner_idx").on(t.ownerVisitorId, t.mode)],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: id(),
    posterId: uuid("poster_id")
      .notNull()
      .references(() => posters.id, { onDelete: "cascade" }),
    ownerVisitorId: uuid("owner_visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** Encrypted token so the owner can see/copy the link again; public lookup uses the hash. */
    tokenSealed: text("token_sealed").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("share_links_token_hash_key").on(t.tokenHash), index("share_links_poster_idx").on(t.posterId)],
);

// ── Infrastructure ──────────────────────────────────────────────────────────

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_keys_scope_key").on(t.visitorId, t.route, t.key)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    jobId: text("job_id").notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_unpublished_idx").on(t.id).where(sql`${t.publishedAt} is null`)],
);

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: id(),
    attemptId: uuid("attempt_id").references(() => photoAttempts.id, { onDelete: "set null" }),
    evaluationId: uuid("evaluation_id").references(() => photoEvaluations.id, { onDelete: "set null" }),
    stage: text("stage").notNull(), // verify | rate
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelConfigVersion: text("model_config_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    referenceVersion: text("reference_version"),
    status: text("status").notNull(), // succeeded | failed
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    latencyMs: integer("latency_ms").notNull(),
    queueWaitMs: integer("queue_wait_ms"),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    estimatedCostUsd: real("estimated_cost_usd"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorType: text("actor_type").notNull(), // admin | visitor | system
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reason: text("reason"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);

/**
 * Runtime settings edited in the admin console (AI provider, map basemap).
 * One row per section; `value` never holds a plaintext AI key (it is sealed).
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(), // ai | map
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid("updated_by").references(() => admins.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
