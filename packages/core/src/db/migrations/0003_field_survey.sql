CREATE TABLE "place_survey_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"admin_id" uuid,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_m" real,
	"readings" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reference_images" ALTER COLUMN "source_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "place_survey_entries" ADD CONSTRAINT "place_survey_entries_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_survey_entries" ADD CONSTRAINT "place_survey_entries_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_survey_entries_place_idx" ON "place_survey_entries" USING btree ("place_id","created_at");