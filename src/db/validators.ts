import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  attachments,
  channels,
  forumTags,
  guilds,
  messages,
  reactions,
  scrapeState,
  threadAppliedTags,
  threads,
  users,
} from "./schema/index.ts";

export const guildInsertSchema = createInsertSchema(guilds);
export const guildSelectSchema = createSelectSchema(guilds);

export const channelInsertSchema = createInsertSchema(channels);
export const channelSelectSchema = createSelectSchema(channels);

export const forumTagInsertSchema = createInsertSchema(forumTags);
export const forumTagSelectSchema = createSelectSchema(forumTags);

export const threadAppliedTagInsertSchema = createInsertSchema(threadAppliedTags);
export const threadAppliedTagSelectSchema = createSelectSchema(threadAppliedTags);

export const userInsertSchema = createInsertSchema(users);
export const userSelectSchema = createSelectSchema(users);

export const threadInsertSchema = createInsertSchema(threads);
export const threadSelectSchema = createSelectSchema(threads);

export const messageInsertSchema = createInsertSchema(messages);
export const messageSelectSchema = createSelectSchema(messages);

export const attachmentInsertSchema = createInsertSchema(attachments);
export const attachmentSelectSchema = createSelectSchema(attachments);

export const reactionInsertSchema = createInsertSchema(reactions);
export const reactionSelectSchema = createSelectSchema(reactions);

export const scrapeStateInsertSchema = createInsertSchema(scrapeState);
export const scrapeStateSelectSchema = createSelectSchema(scrapeState);
