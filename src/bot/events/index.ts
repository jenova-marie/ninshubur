import type { Client } from "discord.js";
import { Events } from "discord.js";
import { makeOnReady } from "./ready.ts";
import { onMessageCreate } from "./messageCreate.ts";
import { onMessageUpdate } from "./messageUpdate.ts";
import { onMessageDelete } from "./messageDelete.ts";
import { onThreadCreate } from "./threadCreate.ts";
import { onThreadUpdate } from "./threadUpdate.ts";
import { onThreadDelete } from "./threadDelete.ts";

export interface EventOptions {
  backfillOnReady: boolean;
}

export function registerEvents(client: Client, options: EventOptions): void {
  client.once(Events.ClientReady, makeOnReady(options));
  client.on(Events.MessageCreate, onMessageCreate);
  client.on(Events.MessageUpdate, onMessageUpdate);
  client.on(Events.MessageDelete, onMessageDelete);
  client.on(Events.ThreadCreate, onThreadCreate);
  client.on(Events.ThreadUpdate, onThreadUpdate);
  client.on(Events.ThreadDelete, onThreadDelete);
}
