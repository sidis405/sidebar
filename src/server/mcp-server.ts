import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fastGlob from "fast-glob";
import { z } from "zod";
import {
  type AnnotationCreatedAtMap,
  addAnnotation,
  listAnnotations,
  removeAnnotation,
  updateAnnotation,
} from "./annotation-ops.js";
import type { DirtyBufferTracker } from "./dirty-buffer.js";
import { readWorkspaceFile } from "./files.js";
import {
  type MentionCreatedAtMap,
  findMention,
  listMentions,
  resolveMention,
} from "./mention-ops.js";
import type { MentionStore } from "./mention-store.js";
import type { VerbCatalog } from "./verbs/index.js";
import type { Workspace } from "./workspace.js";

// The Tier-1 server description (~300 tokens). Every connecting agent sees
// this on `initialize` regardless of whether a richer skill file was
// scaffolded. It is the protocol floor that pins the prose-edit permission
// model, the base_hash protocol, the is_draft signal, and a pointer to
// scaffold-skill (see spec: Skill / Tier 1).
//
// Tokens are roughly 4 chars each for English prose; this string sits around
// 1300 chars to stay safely inside the 200-400 token band.
export const TIER1_DESCRIPTION = [
  "Sidebar is a local-first markdown reading and co-authoring surface for a project's docs.",
  "It hosts the project's workspace (markdown files matching the configured glob) and mediates",
  "collaboration between the human (via a CodeMirror editor in the browser) and you (via this",
  "MCP server). Read tools surface the workspace; write tools, when present, are constrained.",
  "",
  "Permission model. You may read freely, but you may not edit prose unilaterally. Prose changes",
  "happen in only two ways: (1) resolve_mention, when the human has placed a Mention marker",
  "authorizing edits to a specific region; (2) add_annotation(type=suggestion), which proposes",
  "replacement text that the human must accept. You can write note annotations anywhere for",
  "information; notes do not edit prose.",
  "",
  "base_hash protocol. Mention lifecycle uses optimistic concurrency. When you read a mention",
  "you receive its base_hash (first 16 hex chars of sha256(target_content)). resolve_mention",
  "must echo that hash. If the file changed since, you get a conflict; refresh via get_mention",
  "and retry against the new content.",
  "",
  "is_draft signal. read_doc returns is_draft: bool and draft_age_seconds: int. When is_draft is",
  "true, the human has unsaved edits in the editor and the disk content you see is stale. Prefer",
  "to skip the file or create an agent-origin mention with verb clarify asking whether to proceed.",
  "",
  "For full guidance (verb tables, mention round-trip examples, multi-agent etiquette, suggestion",
  "flow), run npx sidebar-md scaffold-skill in this project. That writes a skill file your agent can",
  "load alongside this server.",
].join("\n");

export type McpServerDeps = {
  workspace: Workspace;
  dirtyBuffers: DirtyBufferTracker;
  mentionStore: MentionStore;
  /** Persistent map from mention id -> ISO creation timestamp. Shared
   *  across requests so created_at survives re-scans. */
  mentionCreatedAt: MentionCreatedAtMap;
  /** Persistent map from annotation id -> ISO creation timestamp. */
  annotationCreatedAt: AnnotationCreatedAtMap;
  verbCatalog: VerbCatalog;
  /** Resolved on each call so mid-session git config edits take effect. */
  resolveHumanAuthor: () => string;
};

export function createSidebarMcpServer(deps: McpServerDeps): McpServer {
  const {
    workspace,
    dirtyBuffers,
    mentionStore,
    mentionCreatedAt,
    annotationCreatedAt,
    verbCatalog,
  } = deps;
  void deps.resolveHumanAuthor; // reserved for agent-origin mention path (slice 6)

  const server = new McpServer(
    { name: "sidebar", version: "0.1.0" },
    {
      instructions: TIER1_DESCRIPTION,
      capabilities: { tools: {} },
    },
  );

  // Malformed-marker warnings are emitted by the server's status broadcaster
  // (server.ts buildStatusSnapshot) so we get exactly one warning per affected
  // file per process lifetime. MCP tool calls just read; they don't warn.

  // -------------------------------------------------------------------------
  // Read tools (existing + slice 4)
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_docs",
    {
      description:
        "List every markdown file in the sidebar workspace (the configured workspace glob).",
      inputSchema: {},
    },
    async () => {
      const ignores = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/.sidebar/**"];
      const files = await fastGlob(workspace.innerGlob, {
        cwd: workspace.root,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: ignores,
      });
      const paths = files.sort();
      return {
        content: [{ type: "text", text: JSON.stringify({ paths }) }],
      };
    },
  );

  server.registerTool(
    "read_doc",
    {
      description:
        "Read a markdown file in the sidebar workspace. Returns full content with mention and " +
        "annotation markers intact, plus is_draft (true when the human has unsaved edits in the " +
        "editor) and draft_age_seconds.",
      inputSchema: {
        path: z.string().min(1).describe("POSIX-style path relative to the workspace root."),
      },
    },
    async ({ path }) => {
      try {
        const { content } = await readWorkspaceFile(workspace, path);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                path,
                content,
                is_draft: dirtyBuffers.isDirty(path),
                draft_age_seconds: dirtyBuffers.draftAgeSeconds(path),
              }),
            },
          ],
        };
      } catch (e) {
        return errorResult(`read_doc failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_pending_mentions",
    {
      description:
        "List every open mention across the workspace. Each entry has id, file, origin, verb, " +
        "instruction, author, target_content, base_hash (sha256(target_content) truncated to 16 " +
        "hex chars), and created_at. Orphaned mentions (target region empty/whitespace) are " +
        "included; malformed markers are skipped.",
      inputSchema: {},
    },
    async () => {
      const { mentions } = await listMentions(workspace, mentionCreatedAt);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              mentions: mentions.map(toMentionPayload),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_mention",
    {
      description:
        "Get a single mention by id. Use this to refresh base_hash before retrying " +
        "resolve_mention after a conflict.",
      inputSchema: {
        mention_id: z.string().min(1),
      },
    },
    async ({ mention_id }) => {
      const m = await findMention(workspace, mention_id, mentionCreatedAt);
      if (!m) return errorResult(`get_mention: no open mention with id ${mention_id}`);
      return { content: [{ type: "text", text: JSON.stringify(toMentionPayload(m)) }] };
    },
  );

  server.registerTool(
    "mark_in_progress",
    {
      description:
        "Claim a mention exclusively for processing. First caller wins; subsequent callers " +
        "receive a conflict error including the winning client's name. Release via " +
        "resolve_mention or report_error.",
      inputSchema: {
        mention_id: z.string().min(1),
      },
    },
    async ({ mention_id }) => {
      const m = await findMention(workspace, mention_id, mentionCreatedAt);
      if (!m) return errorResult(`mark_in_progress: no open mention with id ${mention_id}`);
      const agentName = clientNameOf(server) ?? "agent";
      const claim = mentionStore.claim(mention_id, agentName);
      if (!claim.ok) {
        return errorResult(
          `mark_in_progress conflict: mention ${mention_id} is already claimed by ${claim.heldBy}`,
        );
      }
      mentionStore.recordEvent({
        kind: "mention-claimed",
        mention_id,
        file: m.file,
        agent: agentName,
        at: new Date().toISOString(),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, mention_id, agent: agentName }),
          },
        ],
      };
    },
  );

  const resolveActionSchema = z
    .union([
      z.object({
        type: z.literal("replace"),
        content: z.string(),
      }),
      z.object({
        type: z.literal("annotation"),
        annotation_type: z.enum(["note", "suggestion"]),
        text: z.string(),
      }),
    ])
    .describe(
      "{ type: 'replace', content }: overwrite the target region inline (markers go too). " +
        "{ type: 'annotation', annotation_type: 'note', text }: leave a note next to the target. " +
        "annotation_type: 'suggestion' is rejected here; the agent's path to proposing prose " +
        "edits is add_annotation(type='suggestion'), which the human accepts or rejects.",
    );

  server.registerTool(
    "resolve_mention",
    {
      description:
        "Complete a mention. action is either { type: 'replace', content } or { type: 'annotation', " +
        "annotation_type: 'note', text }. base_hash must echo the value returned by get_mention; " +
        "on mismatch the call is refused with a conflict, the agent should call get_mention to " +
        "refresh and retry. Verb policy: action verbs allow replace; query verbs (and any unknown " +
        "verb) allow only annotation. The marker disappears on resolution (ADR-0002).",
      inputSchema: {
        mention_id: z.string().min(1),
        base_hash: z.string().min(1),
        action: resolveActionSchema,
      },
    },
    async ({ mention_id, base_hash, action }) => {
      // Slice 5: the suggestion path lives on add_annotation. Refuse it here
      // so the agent can't smuggle a prose-replacement proposal through the
      // mention lifecycle (which would skip human accept/reject).
      if (action.type === "annotation" && action.annotation_type === "suggestion") {
        return errorResult(
          "resolve_mention: action.annotation_type='suggestion' is not allowed. " +
            "To propose a prose edit, call add_annotation(type='suggestion'); the human " +
            "accepts or rejects via the editor's side card.",
        );
      }

      const m = await findMention(workspace, mention_id, mentionCreatedAt);
      if (!m) return errorResult(`resolve_mention: no open mention with id ${mention_id}`);

      const verbDef = verbCatalog.human.get(m.verb);
      const verbMode = verbDef ? verbDef.mode : "unknown";
      const agentName = clientNameOf(server) ?? "agent";
      const annotationAuthor = agentName;

      const result = await resolveMention(workspace, mention_id, action, base_hash, {
        verbMode,
        annotationAuthor,
        firstSeenAt: mentionCreatedAt,
      });

      if (result.kind === "not-found") {
        return errorResult(`resolve_mention: no open mention with id ${mention_id}`);
      }
      if (result.kind === "orphaned") {
        return errorResult(
          `resolve_mention: mention ${mention_id} is orphaned (target region is empty). ` +
            `The user must cancel or restore it.`,
        );
      }
      if (result.kind === "conflict") {
        return errorResult(
          `resolve_mention conflict: base_hash is stale. Refresh via get_mention (current base_hash=${result.current_base_hash}).`,
        );
      }
      if (result.kind === "verb-not-replaceable") {
        return errorResult(
          `resolve_mention: verb '${result.verb}' is unknown or annotation-only; this mention ` +
            `accepts action { type: 'annotation', annotation_type: 'note', text } only.`,
        );
      }
      // Mention disappeared on resolve; drop the claim and emit an event.
      mentionStore.release(mention_id);
      mentionCreatedAt.delete(mention_id);
      mentionStore.recordEvent({
        kind: "mention-resolved",
        mention_id,
        file: m.file,
        agent: agentName,
        resolution: action.type === "replace" ? "replace" : "annotation",
        at: new Date().toISOString(),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              mention_id,
              file: m.file,
              resolution: action.type === "replace" ? "replace" : "annotation",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "report_error",
    {
      description:
        "Release a claimed mention back to open so the human can retry or cancel. The marker " +
        "stays in place on disk; only the in-progress state is cleared. Use when you cannot " +
        "complete the work.",
      inputSchema: {
        mention_id: z.string().min(1),
        reason: z.string().min(1),
      },
    },
    async ({ mention_id, reason }) => {
      const released = mentionStore.release(mention_id);
      if (!released) {
        return errorResult(
          `report_error: mention ${mention_id} is not claimed (nothing to release).`,
        );
      }
      const m = await findMention(workspace, mention_id, mentionCreatedAt);
      mentionStore.recordEvent({
        kind: "mention-released",
        mention_id,
        file: m?.file ?? "",
        agent: released.agentName,
        reason,
        at: new Date().toISOString(),
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, mention_id, reason }),
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // Annotation tools (slice 5)
  // -------------------------------------------------------------------------

  const targetAnchorSchema = z
    .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
    .describe("Character offsets in the file marking the target region.");

  server.registerTool(
    "list_annotations",
    {
      description:
        "List every annotation (note + suggestion) across the workspace, or in one file " +
        "when `path` is given. Each entry has id, file, type, author, target_content, " +
        "content, target_anchor (start/end char offsets), and created_at.",
      inputSchema: {
        path: z.string().min(1).optional(),
      },
    },
    async ({ path }) => {
      const list = await listAnnotations(workspace, annotationCreatedAt, { path });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              annotations: list.map((a) => ({
                id: a.id,
                file: a.file,
                type: a.type,
                author: a.author,
                target_content: a.targetContent,
                content: a.content,
                target_anchor: { start: a.targetStart, end: a.targetEnd },
                created_at: a.created_at,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "add_annotation",
    {
      description:
        "Create a new annotation. type='note' is pure information; type='suggestion' proposes " +
        "replacement text the human accepts or rejects via the editor side card. author is set " +
        "from the connecting MCP client's identity (clientInfo.name with collision suffix when " +
        "multiple clients share a name).",
      inputSchema: {
        path: z.string().min(1),
        target_anchor: targetAnchorSchema,
        type: z.enum(["note", "suggestion"]),
        content: z.string(),
      },
    },
    async ({ path, target_anchor, type, content }) => {
      try {
        const author = clientNameOf(server) ?? "agent";
        const result = await addAnnotation(workspace, {
          path,
          target_anchor,
          type,
          content,
          author,
        });
        annotationCreatedAt.set(result.annotation.id, new Date().toISOString());
        mentionStore.recordEvent({
          kind: "annotation-created",
          annotation_id: result.annotation.id,
          file: path,
          annotation_type: type,
          author,
          at: new Date().toISOString(),
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: result.annotation.id,
                file: result.annotation.file,
                type: result.annotation.type,
                author: result.annotation.author,
                target_anchor: result.annotation.target_anchor,
              }),
            },
          ],
        };
      } catch (e) {
        return errorResult(`add_annotation failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "update_annotation",
    {
      description:
        "Replace the content of an annotation. The agent can only update annotations whose " +
        "author matches its own client identity.",
      inputSchema: {
        id: z.string().min(1),
        content: z.string(),
      },
    },
    async ({ id, content }) => {
      const author = clientNameOf(server) ?? "agent";
      const result = await updateAnnotation(workspace, id, content, {
        requireAuthor: author,
        firstSeenAt: annotationCreatedAt,
      });
      if (result.kind === "not-found") {
        return errorResult(`update_annotation: no annotation with id ${id}`);
      }
      if (result.kind === "forbidden") {
        return errorResult(
          `update_annotation: annotation ${id} was authored by ${result.author}; ` +
            `you can only update annotations you authored (current identity: ${author}).`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, id, file: result.file }) }],
      };
    },
  );

  server.registerTool(
    "remove_annotation",
    {
      description:
        "Remove an annotation. Strips the begin/end pair; the target prose stays. The agent " +
        "can only remove annotations whose author matches its own client identity.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const author = clientNameOf(server) ?? "agent";
      const result = await removeAnnotation(workspace, id, {
        requireAuthor: author,
        firstSeenAt: annotationCreatedAt,
      });
      if (result.kind === "not-found") {
        return errorResult(`remove_annotation: no annotation with id ${id}`);
      }
      if (result.kind === "forbidden") {
        return errorResult(
          `remove_annotation: annotation ${id} was authored by ${result.author}; ` +
            `you can only remove annotations you authored (current identity: ${author}).`,
        );
      }
      mentionStore.recordEvent({
        kind: "annotation-removed",
        annotation_id: id,
        file: result.file,
        annotation_type: result.type,
        author,
        at: new Date().toISOString(),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, id, file: result.file }) }],
      };
    },
  );

  server.registerTool(
    "list_recent_changes",
    {
      description:
        "Return recent workspace activity: human file edits, mention create/claim/resolve/release " +
        "events. Pass `since` (last event id you've seen) to fetch only newer events. Default " +
        "returns the last 50.",
      inputSchema: {
        since: z.number().int().optional(),
      },
    },
    async ({ since }) => {
      const events = mentionStore.recentEvents(since);
      return {
        content: [{ type: "text", text: JSON.stringify({ events }) }],
      };
    },
  );

  return server;
}

function toMentionPayload(m: {
  id: string;
  file: string;
  origin: string;
  verb: string;
  author: string;
  instruction: string;
  targetContent: string;
  baseHash: string;
  orphan: boolean;
  created_at: string;
}): Record<string, unknown> {
  return {
    id: m.id,
    file: m.file,
    origin: m.origin,
    verb: m.verb,
    author: m.author,
    instruction: m.instruction,
    target_content: m.targetContent,
    base_hash: m.baseHash,
    orphan: m.orphan,
    created_at: m.created_at,
  };
}

function clientNameOf(server: McpServer): string | null {
  // McpServer exposes the underlying low-level Server which carries the
  // connected client's clientInfo after `initialize`. Different SDK versions
  // expose this in slightly different ways; try the common shapes.
  // biome-ignore lint/suspicious/noExplicitAny: SDK internals shape
  const s = server as any;
  const inner = s.server ?? s;
  const ci =
    inner?.getClientVersion?.() ??
    inner?._clientVersion ??
    inner?.clientInfo ??
    inner?._serverInfo ??
    null;
  if (ci && typeof ci.name === "string" && ci.name.length > 0) return ci.name;
  return null;
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}
