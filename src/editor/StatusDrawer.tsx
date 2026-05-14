import { useEffect, useRef, useState } from "react";
import type {
  ConnectedAgentView,
  PendingMentionView,
  RecentEventView,
  StatusSnapshot,
} from "../shared/protocol.ts";

// Slice 4 status drawer.
//
// Spec: Editor (V1) — "Status drawer. Collapsible side panel: list of
// connected agents (name with collision suffix, connect time), pending
// mentions list with originator and verb, recent activity (last 50 events),
// agent-mention rate-limit counter (slice 6, deferred here), in-progress
// mention processing status. Right-click on a pending mention exposes a
// 'cancel mention' action that removes the begin/end pair from the file.
// Right-click on an in-progress mention exposes 'release stuck claim' as an
// escape hatch for wedged agents."

export type StatusDrawerProps = {
  snapshot: StatusSnapshot | null;
  onCancelMention: (id: string) => void;
  onReleaseClaim: (id: string) => void;
  onOpenFile: (path: string) => void;
};

type ContextMenu =
  | { kind: "pending"; id: string; x: number; y: number }
  | { kind: "inProgress"; id: string; x: number; y: number };

export function StatusDrawer({
  snapshot,
  onCancelMention,
  onReleaseClaim,
  onOpenFile,
}: StatusDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("scroll", () => setMenu(null), true);
    return () => {
      window.removeEventListener("mousedown", close, true);
    };
  }, [menu]);

  const pending = snapshot?.pendingMentions ?? [];
  const agents = snapshot?.connectedAgents ?? [];
  const recent = snapshot?.recentEvents ?? [];
  const inProgress = pending.filter((p) => p.inProgress);
  const openPending = pending.filter((p) => !p.inProgress);

  return (
    <aside className={`status-drawer${collapsed ? " is-collapsed" : ""}`}>
      <header className="status-drawer-header">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="status-drawer-toggle"
          aria-label={collapsed ? "Expand status drawer" : "Collapse status drawer"}
        >
          {collapsed ? "›" : "‹"}
        </button>
        {!collapsed && <span className="status-drawer-title">status</span>}
      </header>
      {!collapsed && (
        <div className="status-drawer-body">
          <section className="status-section">
            <h3>Pending mentions ({openPending.length})</h3>
            {openPending.length === 0 ? (
              <p className="status-empty">No open mentions.</p>
            ) : (
              <ul className="status-list">
                {openPending.map((m) => (
                  <li
                    key={m.id}
                    className={`status-list-item${m.orphan ? " is-orphan" : ""}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ kind: "pending", id: m.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <button
                      type="button"
                      className="status-list-link"
                      onClick={() => onOpenFile(m.file)}
                    >
                      <code className="status-id">{m.id}</code>
                      <span className="status-verb">{m.verb}</span>
                      <span className="status-author">{m.author}</span>
                      {m.orphan && <span className="status-flag">orphan</span>}
                      <span className="status-file">{m.file}</span>
                    </button>
                    {m.instruction && <div className="status-instruction">{m.instruction}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="status-section">
            <h3>In progress ({inProgress.length})</h3>
            {inProgress.length === 0 ? (
              <p className="status-empty">No agents are claiming a mention right now.</p>
            ) : (
              <ul className="status-list">
                {inProgress.map((m) => (
                  <li
                    key={m.id}
                    className="status-list-item is-in-progress"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ kind: "inProgress", id: m.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <code className="status-id">{m.id}</code>
                    <span className="status-verb">{m.verb}</span>
                    <span className="status-claimed">claimed by {m.inProgress?.agent}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="status-section">
            <h3>Connected agents ({agents.length})</h3>
            {agents.length === 0 ? (
              <p className="status-empty">No agent connected.</p>
            ) : (
              <ul className="status-list">
                {agents.map((a: ConnectedAgentView) => (
                  <li key={a.name} className="status-list-item">
                    <span className="status-agent-name">{a.name}</span>
                    <span className="status-agent-since">
                      since {new Date(a.connectedAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="status-section">
            <h3>Recent activity ({recent.length})</h3>
            {recent.length === 0 ? (
              <p className="status-empty">Nothing yet.</p>
            ) : (
              <ul className="status-list status-recent">
                {recent
                  .slice()
                  .reverse()
                  .map((e: RecentEventView) => (
                    <li key={e.id} className="status-list-item">
                      <code className="status-kind">{e.kind}</code>
                      {e.mention_id && <code className="status-id">{e.mention_id}</code>}
                      {e.annotation_id && <code className="status-id">{e.annotation_id}</code>}
                      {e.annotation_type && (
                        <span className="status-verb">{e.annotation_type}</span>
                      )}
                      {e.file && <span className="status-file">{e.file}</span>}
                      {e.agent && <span className="status-agent-name">{e.agent}</span>}
                      {e.author && !e.agent && (
                        <span className="status-agent-name">{e.author}</span>
                      )}
                      <span className="status-time">{new Date(e.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {menu && (
        <div ref={menuRef} className="context-menu" style={{ top: menu.y, left: menu.x }}>
          {menu.kind === "pending" && (
            <button
              type="button"
              onClick={() => {
                onCancelMention(menu.id);
                setMenu(null);
              }}
            >
              cancel mention
            </button>
          )}
          {menu.kind === "inProgress" && (
            <button
              type="button"
              onClick={() => {
                onReleaseClaim(menu.id);
                setMenu(null);
              }}
            >
              release stuck claim
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** Drop-in fallback for {@link PendingMentionView} when the editor renders an
 *  empty drawer before the first snapshot arrives. Exported for test
 *  scaffolding. */
export const EMPTY_PENDING: PendingMentionView[] = [];
