CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'haiku' NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_categories" (
	"message_id" varchar(20) NOT NULL,
	"category_id" uuid NOT NULL,
	"confidence" real,
	"source" text DEFAULT 'haiku' NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_categories_message_id_category_id_pk" PRIMARY KEY("message_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "message_group_members" (
	"group_id" uuid NOT NULL,
	"message_id" varchar(20) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "message_group_members_group_id_message_id_pk" PRIMARY KEY("group_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "message_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"thread_id" varchar(20),
	"summary" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"qdrant_point_id" text NOT NULL,
	"qdrant_collection" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "message_categories" ADD CONSTRAINT "message_categories_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_categories" ADD CONSTRAINT "message_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_group_members" ADD CONSTRAINT "message_group_members_group_id_message_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."message_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_group_members" ADD CONSTRAINT "message_group_members_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "message_categories_category_idx" ON "message_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "message_group_members_message_idx" ON "message_group_members" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_groups_channel_idx" ON "message_groups" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "message_groups_thread_idx" ON "message_groups" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "message_groups_started_idx" ON "message_groups" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_scope_model_idx" ON "embeddings" USING btree ("scope_type","scope_id","model");--> statement-breakpoint
CREATE INDEX "llm_jobs_kind_started_idx" ON "llm_jobs" USING btree ("kind","started_at");--> statement-breakpoint
CREATE INDEX "llm_jobs_status_idx" ON "llm_jobs" USING btree ("status");