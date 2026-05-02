CREATE TABLE "guilds" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon_hash" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"type" integer NOT NULL,
	"name" text NOT NULL,
	"topic" text,
	"parent_id" varchar(20),
	"position" integer,
	"nsfw" boolean DEFAULT false NOT NULL,
	"rate_limit_per_user" integer,
	"last_message_id" varchar(20),
	"default_auto_archive_duration" integer,
	"default_thread_rate_limit_per_user" integer,
	"default_sort_order" integer,
	"default_forum_layout" integer,
	"default_reaction_emoji" jsonb,
	"flags" integer DEFAULT 0 NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_tags" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"moderated" boolean DEFAULT false NOT NULL,
	"emoji_id" varchar(20),
	"emoji_name" text
);
--> statement-breakpoint
CREATE TABLE "thread_applied_tags" (
	"thread_id" varchar(20) NOT NULL,
	"tag_id" varchar(20) NOT NULL,
	CONSTRAINT "thread_applied_tags_thread_id_tag_id_pk" PRIMARY KEY("thread_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"discriminator" text,
	"avatar_hash" text,
	"bot" boolean DEFAULT false NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"public_flags" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"owner_id" varchar(20),
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"invitable" boolean,
	"auto_archive_duration" integer,
	"rate_limit_per_user" integer,
	"message_count" integer DEFAULT 0 NOT NULL,
	"total_message_sent" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL,
	"type" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"last_message_id" varchar(20),
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"thread_id" varchar(20),
	"author_id" varchar(20),
	"content" text DEFAULT '' NOT NULL,
	"type" integer NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"tts" boolean DEFAULT false NOT NULL,
	"mention_everyone" boolean DEFAULT false NOT NULL,
	"referenced_message_id" varchar(20),
	"webhook_id" varchar(20),
	"application_id" varchar(20),
	"embeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentioned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentioned_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"message_id" varchar(20) NOT NULL,
	"filename" text NOT NULL,
	"title" text,
	"description" text,
	"content_type" text,
	"size" bigint NOT NULL,
	"url" text NOT NULL,
	"proxy_url" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_secs" integer,
	"waveform" text,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" varchar(20) NOT NULL,
	"emoji_key" text NOT NULL,
	"emoji_id" varchar(20),
	"emoji_name" text,
	"animated" boolean DEFAULT false NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"burst_count" integer DEFAULT 0 NOT NULL,
	"me" boolean DEFAULT false NOT NULL,
	CONSTRAINT "reactions_message_id_emoji_key_pk" PRIMARY KEY("message_id","emoji_key")
);
--> statement-breakpoint
CREATE TABLE "scrape_state" (
	"scope_id" varchar(20) PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"last_message_id" varchar(20),
	"last_full_scrape_at" timestamp with time zone,
	"last_incremental_scrape_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_tags" ADD CONSTRAINT "forum_tags_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_applied_tags" ADD CONSTRAINT "thread_applied_tags_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_applied_tags" ADD CONSTRAINT "thread_applied_tags_tag_id_forum_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."forum_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_guild_idx" ON "channels" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "channels_type_idx" ON "channels" USING btree ("type");--> statement-breakpoint
CREATE INDEX "threads_channel_idx" ON "threads" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "threads_owner_idx" ON "threads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "threads_archived_idx" ON "threads" USING btree ("archived");--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reactions_message_idx" ON "reactions" USING btree ("message_id");