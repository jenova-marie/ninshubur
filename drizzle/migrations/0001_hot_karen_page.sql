ALTER TABLE "messages" ADD COLUMN "referenced_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "referenced_guild_id" varchar(20);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reference_type" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "message_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;