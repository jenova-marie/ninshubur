import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  attachments,
  categories,
  channels,
  embeddings,
  forumTags,
  guilds,
  llmJobs,
  messageCategories,
  messageGroupMembers,
  messageGroups,
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

export const categoryInsertSchema = createInsertSchema(categories);
export const categorySelectSchema = createSelectSchema(categories);

export const messageCategoryInsertSchema = createInsertSchema(messageCategories);
export const messageCategorySelectSchema = createSelectSchema(messageCategories);

export const messageGroupInsertSchema = createInsertSchema(messageGroups);
export const messageGroupSelectSchema = createSelectSchema(messageGroups);

export const messageGroupMemberInsertSchema = createInsertSchema(messageGroupMembers);
export const messageGroupMemberSelectSchema = createSelectSchema(messageGroupMembers);

export const embeddingInsertSchema = createInsertSchema(embeddings);
export const embeddingSelectSchema = createSelectSchema(embeddings);

export const llmJobInsertSchema = createInsertSchema(llmJobs);
export const llmJobSelectSchema = createSelectSchema(llmJobs);
