import type { ChangeEvent } from "../connector/types.js";
import type { EventStore } from "./types.js";

type Stream = { events: ChangeEvent[]; seq: number; trimmedBefore: number };

export function createMemoryEventStore(): EventStore {
  const streams = new Map<string, Stream>();

  function key(connectorId: string, table: string): string {
    return `${connectorId}/${table}`;
  }

  return {
    async append(connectorId, table, events) {
      if (events.length === 0) return;
      const k = key(connectorId, table);
      const stream = streams.get(k) ?? { events: [], seq: 0, trimmedBefore: 0 };
      stream.events.push(...events);
      stream.seq += events.length;
      streams.set(k, stream);
    },

    async read(connectorId, table, fromSeq) {
      const stream = streams.get(key(connectorId, table));
      if (!stream) return { events: [], nextSeq: fromSeq ?? 0 };
      const startIdx = (fromSeq ?? 0) - stream.trimmedBefore;
      return { events: stream.events.slice(Math.max(0, startIdx)), nextSeq: stream.seq };
    },

    trim(connectorId, table, beforeSeq) {
      const stream = streams.get(key(connectorId, table));
      if (!stream || beforeSeq <= stream.trimmedBefore) return;
      const toRemove = beforeSeq - stream.trimmedBefore;
      stream.events = stream.events.slice(toRemove);
      stream.trimmedBefore = beforeSeq;
    },
  };
}
