CREATE TYPE "public"."asset_kind" AS ENUM('user_photo', 'reference', 'poster', 'sample', 'brand');--> statement-breakpoint
CREATE TYPE "public"."asset_state" AS ENUM('ready', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."checkin_method" AS ENUM('location', 'photo');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('live', 'demo');--> statement-breakpoint
CREATE TYPE "public"."place_status" AS ENUM('draft', 'published', 'temporarily_closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."poster_status" AS ENUM('queued', 'rendering', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."proof_policy" AS ENUM('location', 'photo', 'either');--> statement-breakpoint
CREATE TYPE "public"."quest_run_status" AS ENUM('active', 'ended_partial', 'completed');--> statement-breakpoint
CREATE TYPE "public"."rating_status" AS ENUM('not_requested', 'pending', 'completed', 'unscorable', 'error');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('open', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."verification_source" AS ENUM('ai', 'human', 'demo_sample');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'matched', 'uncertain', 'mismatched', 'error');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid,
	"evaluation_id" uuid,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_config_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"reference_version" text,
	"status" text NOT NULL,
	"error_code" text,
	"error_detail" text,
	"latency_ms" integer NOT NULL,
	"queue_wait_ms" integer,
	"usage" jsonb,
	"estimated_cost_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"owner_visitor_id" uuid,
	"mode" "mode",
	"object_key" text NOT NULL,
	"thumb_key" text,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"state" "asset_state" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"place_id" uuid NOT NULL,
	"method" "checkin_method" NOT NULL,
	"attempt_id" uuid,
	"arrival_verified" boolean NOT NULL,
	"distance_meters" real,
	"accuracy_meters" real,
	"simulated" boolean DEFAULT false NOT NULL,
	"raw_latitude" double precision,
	"raw_longitude" double precision,
	"raw_purged_at" timestamp with time zone,
	"quest_run_id" uuid,
	"quest_step_id" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_zh" text NOT NULL,
	"name_ja" text NOT NULL,
	"name_en" text,
	"summary" text DEFAULT '' NOT NULL,
	"center" geography(Point,4326) NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "photo_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"place_id" uuid NOT NULL,
	"place_version_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"context_key" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"quest_run_id" uuid,
	"quest_step_id" uuid,
	"location_evidence" jsonb,
	"sample_key" text,
	"processing_status" "processing_status" DEFAULT 'queued' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"rating_status" "rating_status" DEFAULT 'not_requested' NOT NULL,
	"error_code" text,
	"error_stage" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"place_version_id" uuid NOT NULL,
	"image_sha256" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_config_version" text NOT NULL,
	"verify_prompt_version" text NOT NULL,
	"rating_prompt_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"reference_version" text NOT NULL,
	"cache_key" text NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verification" jsonb,
	"rating_status" "rating_status" DEFAULT 'not_requested' NOT NULL,
	"rating" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"place_id" uuid NOT NULL,
	"composition" integer NOT NULL,
	"lighting" integer NOT NULL,
	"clarity" integer NOT NULL,
	"expression" integer NOT NULL,
	"total" integer NOT NULL,
	"grade" text NOT NULL,
	"strength" text NOT NULL,
	"improvement" text NOT NULL,
	"rubric_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"first_checkin_id" uuid,
	"best_rating_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"source" "verification_source" NOT NULL,
	"verdict" text NOT NULL,
	"reason_code" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_message" text NOT NULL,
	"reshoot_suggestion" text,
	"reviewer_id" uuid,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name_zh" text NOT NULL,
	"name_ja" text NOT NULL,
	"name_en" text,
	"content" jsonb NOT NULL,
	"reference_image_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_version" text NOT NULL,
	"photo_enabled" boolean NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"neighborhood_id" uuid NOT NULL,
	"name_zh" text NOT NULL,
	"name_ja" text NOT NULL,
	"name_en" text,
	"geo" geography(Point,4326) NOT NULL,
	"status" "place_status" DEFAULT 'draft' NOT NULL,
	"radius_m" integer DEFAULT 100 NOT NULL,
	"photo_enabled" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stay_minutes" integer,
	"published_version_id" uuid,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"template_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"asset_id" uuid,
	"rendered_with_share_id" uuid,
	"status" "poster_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"quest_id" uuid NOT NULL,
	"quest_version_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"status" "quest_run_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quest_step_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"checkin_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"place_id" uuid NOT NULL,
	"proof_policy" "proof_policy" DEFAULT 'either' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"title" text NOT NULL,
	"story" text NOT NULL,
	"objective" text NOT NULL,
	"clue" text NOT NULL,
	"observation_question" text NOT NULL,
	"completion_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"intro" text NOT NULL,
	"ending" text NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"fiction_note" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"neighborhood_id" uuid NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"view_note" text NOT NULL,
	"source_url" text NOT NULL,
	"author" text NOT NULL,
	"license" text NOT NULL,
	"usage_basis" text NOT NULL,
	"public_display" boolean DEFAULT false NOT NULL,
	"captured_on" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"note" text,
	"reviewer_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"visitor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poster_id" uuid NOT NULL,
	"owner_visitor_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_sealed" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stamp_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"mode" "mode" NOT NULL,
	"stamp_key" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_attempt_id_photo_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."photo_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_evaluation_id_photo_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."photo_evaluations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_visitor_id_visitors_id_fk" FOREIGN KEY ("owner_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_attempt_id_photo_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."photo_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_quest_run_id_quest_runs_id_fk" FOREIGN KEY ("quest_run_id") REFERENCES "public"."quest_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_quest_step_id_quest_steps_id_fk" FOREIGN KEY ("quest_step_id") REFERENCES "public"."quest_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_place_version_id_place_versions_id_fk" FOREIGN KEY ("place_version_id") REFERENCES "public"."place_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_evaluation_id_photo_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."photo_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_quest_run_id_quest_runs_id_fk" FOREIGN KEY ("quest_run_id") REFERENCES "public"."quest_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_attempts" ADD CONSTRAINT "photo_attempts_quest_step_id_quest_steps_id_fk" FOREIGN KEY ("quest_step_id") REFERENCES "public"."quest_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_evaluations" ADD CONSTRAINT "photo_evaluations_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_evaluations" ADD CONSTRAINT "photo_evaluations_place_version_id_place_versions_id_fk" FOREIGN KEY ("place_version_id") REFERENCES "public"."place_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_ratings" ADD CONSTRAINT "photo_ratings_attempt_id_photo_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."photo_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_ratings" ADD CONSTRAINT "photo_ratings_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_ratings" ADD CONSTRAINT "photo_ratings_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_progress" ADD CONSTRAINT "place_progress_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_progress" ADD CONSTRAINT "place_progress_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_progress" ADD CONSTRAINT "place_progress_first_checkin_id_checkins_id_fk" FOREIGN KEY ("first_checkin_id") REFERENCES "public"."checkins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_progress" ADD CONSTRAINT "place_progress_best_rating_id_photo_ratings_id_fk" FOREIGN KEY ("best_rating_id") REFERENCES "public"."photo_ratings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_verifications" ADD CONSTRAINT "place_verifications_attempt_id_photo_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."photo_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_versions" ADD CONSTRAINT "place_versions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posters" ADD CONSTRAINT "posters_owner_visitor_id_visitors_id_fk" FOREIGN KEY ("owner_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posters" ADD CONSTRAINT "posters_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_runs" ADD CONSTRAINT "quest_runs_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_runs" ADD CONSTRAINT "quest_runs_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_runs" ADD CONSTRAINT "quest_runs_quest_version_id_quest_versions_id_fk" FOREIGN KEY ("quest_version_id") REFERENCES "public"."quest_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_step_progress" ADD CONSTRAINT "quest_step_progress_run_id_quest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."quest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_step_progress" ADD CONSTRAINT "quest_step_progress_step_id_quest_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."quest_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_step_progress" ADD CONSTRAINT "quest_step_progress_checkin_id_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."checkins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_steps" ADD CONSTRAINT "quest_steps_quest_version_id_quest_versions_id_fk" FOREIGN KEY ("quest_version_id") REFERENCES "public"."quest_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_steps" ADD CONSTRAINT "quest_steps_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_versions" ADD CONSTRAINT "quest_versions_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_attempt_id_photo_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."photo_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_reviewer_id_admins_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_poster_id_posters_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."posters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_owner_visitor_id_visitors_id_fk" FOREIGN KEY ("owner_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_awards" ADD CONSTRAINT "stamp_awards_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "admins_username_key" ON "admins" USING btree ("username");--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_object_key_key" ON "assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_visitor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_attempt_key" ON "checkins" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "checkins_visitor_idx" ON "checkins" USING btree ("visitor_id","mode","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key" ON "idempotency_keys" USING btree ("visitor_id","route","key");--> statement-breakpoint
CREATE UNIQUE INDEX "neighborhoods_slug_key" ON "neighborhoods" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_attempts_dedupe_key" ON "photo_attempts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "photo_attempts_visitor_idx" ON "photo_attempts" USING btree ("visitor_id","mode","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_evaluations_cache_key" ON "photo_evaluations" USING btree ("cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_ratings_attempt_key" ON "photo_ratings" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "photo_ratings_best_idx" ON "photo_ratings" USING btree ("visitor_id","mode","place_id","rubric_version");--> statement-breakpoint
CREATE UNIQUE INDEX "place_progress_visitor_place_mode_key" ON "place_progress" USING btree ("visitor_id","place_id","mode");--> statement-breakpoint
CREATE INDEX "place_verifications_attempt_idx" ON "place_verifications" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_versions_place_version_key" ON "place_versions" USING btree ("place_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "places_slug_key" ON "places" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "places_geo_gist" ON "places" USING gist ("geo");--> statement-breakpoint
CREATE INDEX "places_neighborhood_idx" ON "places" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "posters_owner_idx" ON "posters" USING btree ("owner_visitor_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_runs_one_active_key" ON "quest_runs" USING btree ("visitor_id","quest_id","mode") WHERE "quest_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "quest_runs_visitor_idx" ON "quest_runs" USING btree ("visitor_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_step_progress_run_step_key" ON "quest_step_progress" USING btree ("run_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_steps_version_position_key" ON "quest_steps" USING btree ("quest_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_versions_quest_version_key" ON "quest_versions" USING btree ("quest_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quests_slug_key" ON "quests" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "reference_images_place_idx" ON "reference_images" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_one_open_key" ON "review_requests" USING btree ("attempt_id") WHERE "review_requests"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_visitor_idx" ON "sessions" USING btree ("visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_poster_idx" ON "share_links" USING btree ("poster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stamp_awards_visitor_mode_key" ON "stamp_awards" USING btree ("visitor_id","mode","stamp_key");