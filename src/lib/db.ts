/**
 * MeshlyDB — Dexie/IndexedDB schema
 *
 * Tables:
 *   messages  — cached messages per chat (replaces localStorage)
 *   outbox    — pending (unsent) messages queued while offline
 *   appState  — key/value store for last route, scroll position, etc.
 *
 * The database is versioned. Bump the version number whenever you change
 * the schema, and add a migration in `.upgrade()`.
 */
import Dexie, { type Table } from "dexie";
import type { Message } from "./mockStore";

export interface AppStateRow {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

/** A user action created offline and replayed when connectivity returns. */
export interface QueuedAction {
  id: string;
  kind: "channel-post" | "comment";
  /** Kind-specific fields (channelId, body, image File, localId…). Files and
   * Blobs are persisted fine by IndexedDB's structured clone. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  createdAt: number;
}

class MeshlyDB extends Dexie {
  messages!: Table<Message, string>;
  outbox!: Table<Message, string>;
  appState!: Table<AppStateRow, string>;
  actions!: Table<QueuedAction, string>;

  constructor() {
    super("MeshlyDB");
    this.version(1).stores({
      // Primary key first, then indexed fields
      messages: "id, chatId, createdAt",
      outbox: "id, chatId, createdAt",
      appState: "key",
    });
    this.version(2).stores({
      appState: "key",
      messages: "id, chatId, createdAt",
      outbox: "id, chatId, createdAt",
      actions: "id, kind, createdAt",
    });
  }
}

/** Singleton DB instance — safe to import anywhere. */
export const db = new MeshlyDB();
