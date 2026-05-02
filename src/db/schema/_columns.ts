import { varchar } from "drizzle-orm/pg-core";

/**
 * Discord snowflakes are 64-bit unsigned IDs serialised as strings.
 * varchar(20) fits the maximum width without burning bytes.
 */
export const snowflake = (name: string) => varchar(name, { length: 20 });
