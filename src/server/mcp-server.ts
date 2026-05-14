import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fastGlob from "fast-glob";
import { z } from "zod";
import type { DirtyBufferTracker } from "./dirty-buffer.js";
import { readWorkspaceFile } from "./files.js";
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
  "you receive its base_hash. resolve_mention must echo that hash. If the file changed since,",
  "you get a conflict; refresh via get_mention and retry against the new content.",
  "",
  "is_draft signal. read_doc returns is_draft: bool and draft_age_seconds: int. When is_draft is",
  "true, the human has unsaved edits in the editor and the disk content you see is stale. Prefer",
  "to skip the file or create an agent-origin mention with verb clarify asking whether to proceed.",
  "",
  "For full guidance (verb tables, mention round-trip examples, multi-agent etiquette, suggestion",
  "flow), run npx sidebar scaffold-skill in this project. That writes a skill file your agent can",
  "load alongside this server.",
].join("\n");

export type McpServerDeps = {
  workspace: Workspace;
  dirtyBuffers: DirtyBufferTracker;
};

export function createSidebarMcpServer(deps: McpServerDeps): McpServer {
  const { workspace, dirtyBuffers } = deps;

  const server = new McpServer(
    { name: "sidebar", version: "0.1.0" },
    {
      instructions: TIER1_DESCRIPTION,
      capabilities: { tools: {} },
    },
  );

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

  return server;
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}
