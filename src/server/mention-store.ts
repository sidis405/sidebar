// In-memory state layer for slice 4. Holds:
//
//   - mention claims (the transient in-progress state for each open mention,
//     plus the claiming client's identity for conflict reporting)
//   - the recent-changes ring buffer (last 50 events, monotonic id cursor)
//   - connected MCP clients (for the status drawer)
//
// State is process-local and resets on restart. Persistence is out of scope
// for V1 (spec: Architecture / In-memory state layer).

export type ClaimRecord = {
  mentionId: string;
  agentName: string;
  claimedAt: number;
};

export type RecentEvent =
  | {
      id: number;
      kind: "mention-created";
      mention_id: string;
      file: string;
      verb: string;
      origin: "human" | "agent";
      author: string;
      at: string;
    }
  | {
      id: number;
      kind: "mention-claimed";
      mention_id: string;
      file: string;
      agent: string;
      at: string;
    }
  | {
      id: number;
      kind: "mention-released";
      mention_id: string;
      file: string;
      agent: string;
      reason: string;
      at: string;
    }
  | {
      id: number;
      kind: "mention-resolved";
      mention_id: string;
      file: string;
      agent: string;
      resolution: "replace" | "annotation";
      at: string;
    }
  | {
      id: number;
      kind: "mention-cancelled";
      mention_id: string;
      file: string;
      at: string;
    }
  | {
      id: number;
      kind: "file-edited";
      file: string;
      author: string;
      at: string;
    };

export type ConnectedAgent = {
  name: string;
  connectedAt: number;
};

export type RecentEventInput =
  | Omit<Extract<RecentEvent, { kind: "mention-created" }>, "id">
  | Omit<Extract<RecentEvent, { kind: "mention-claimed" }>, "id">
  | Omit<Extract<RecentEvent, { kind: "mention-released" }>, "id">
  | Omit<Extract<RecentEvent, { kind: "mention-resolved" }>, "id">
  | Omit<Extract<RecentEvent, { kind: "mention-cancelled" }>, "id">
  | Omit<Extract<RecentEvent, { kind: "file-edited" }>, "id">;

export type MentionStore = {
  claim: (mentionId: string, agentName: string) => { ok: true } | { ok: false; heldBy: string };
  release: (mentionId: string) => ClaimRecord | null;
  claimOf: (mentionId: string) => ClaimRecord | null;
  /** All current claims, snapshot. */
  claims: () => ClaimRecord[];
  recordEvent: (e: RecentEventInput) => RecentEvent;
  recentEvents: (since?: number) => RecentEvent[];
  registerAgent: (name: string) => () => void;
  connectedAgents: () => ConnectedAgent[];
  onChange: (fn: () => void) => () => void;
};

const RING_CAPACITY = 50;

export function createMentionStore(now: () => number = Date.now): MentionStore {
  const claims = new Map<string, ClaimRecord>();
  const ring: RecentEvent[] = [];
  let nextEventId = 1;
  const agents = new Map<string, ConnectedAgent>();
  // Multiple connections from one client get a "-2", "-3" suffix while
  // simultaneous; we track per-name counts.
  const nameUseCounts = new Map<string, number>();
  const changeListeners = new Set<() => void>();

  const notify = () => {
    for (const fn of changeListeners) {
      try {
        fn();
      } catch {
        /* listener errors should not break the store */
      }
    }
  };

  return {
    claim(mentionId, agentName) {
      const existing = claims.get(mentionId);
      if (existing) return { ok: false, heldBy: existing.agentName };
      claims.set(mentionId, { mentionId, agentName, claimedAt: now() });
      notify();
      return { ok: true };
    },
    release(mentionId) {
      const cur = claims.get(mentionId);
      if (!cur) return null;
      claims.delete(mentionId);
      notify();
      return cur;
    },
    claimOf(mentionId) {
      return claims.get(mentionId) ?? null;
    },
    claims() {
      return Array.from(claims.values());
    },
    recordEvent(partial) {
      const event = { ...partial, id: nextEventId++ } as RecentEvent;
      ring.push(event);
      if (ring.length > RING_CAPACITY) ring.shift();
      notify();
      return event;
    },
    recentEvents(since) {
      if (since === undefined || since === null) return ring.slice();
      return ring.filter((e) => e.id > since);
    },
    registerAgent(name) {
      const count = (nameUseCounts.get(name) ?? 0) + 1;
      nameUseCounts.set(name, count);
      const effective = count === 1 ? name : `${name}-${count}`;
      agents.set(effective, { name: effective, connectedAt: now() });
      notify();
      return () => {
        agents.delete(effective);
        const c = (nameUseCounts.get(name) ?? 0) - 1;
        if (c <= 0) nameUseCounts.delete(name);
        else nameUseCounts.set(name, c);
        notify();
      };
    },
    connectedAgents() {
      return Array.from(agents.values()).sort((a, b) => a.connectedAt - b.connectedAt);
    },
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
  };
}
