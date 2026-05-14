import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// `npx sidebar-md init [agent]` writes a project-local `.mcp.json` entry that
// spawns `npx sidebar-md --stdio`. V1 supports the Claude Code / Compound
// shared `.mcp.json` layout (one entry under `mcpServers`). See ADR-0007.
//
// Existing unrelated entries in `.mcp.json` are preserved. Re-running is
// idempotent: the sidebar entry is overwritten rather than duplicated.

export const SUPPORTED_AGENTS = ["claude-code"] as const;
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

export function isSupportedAgent(name: string): name is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(name);
}

export type InitOutcome = {
  path: string;
  /** "created" when the file was new, "updated" when an existing entry changed. */
  action: "created" | "updated" | "unchanged";
  /** The full set of mcpServers keys after the write. */
  agents: string[];
};

export type SidebarEntry = {
  command: string;
  args: string[];
};

export function sidebarMcpEntry(): SidebarEntry {
  // `npx sidebar-md --stdio` is the locked invite shape (ADR-0007). Anyone
  // wanting a different command (e.g. a globally installed `sidebar-md` bin)
  // can edit the file by hand; sidebar's own init writes the npx form.
  return { command: "npx", args: ["sidebar-md", "--stdio"] };
}

export async function runInit(cwd: string, _agent: SupportedAgent): Promise<InitOutcome> {
  // Slice 02 ships the Claude Code / Compound layout only. The agent
  // parameter is reserved for V1.1 when Cursor and Aider variants land.
  const path = join(cwd, ".mcp.json");
  let existing: Record<string, unknown> | null = null;
  if (existsSync(path)) {
    const raw = await readFile(path, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      } else {
        throw new Error(`.mcp.json is not a JSON object (got ${typeof parsed})`);
      }
    } catch (e) {
      throw new Error(`failed to parse existing .mcp.json: ${(e as Error).message}`);
    }
  }

  const base: Record<string, unknown> = existing ?? {};
  const servers = (
    base.mcpServers && typeof base.mcpServers === "object"
      ? { ...(base.mcpServers as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const before = JSON.stringify(servers["sidebar-md"] ?? null);
  const entry = sidebarMcpEntry();
  servers["sidebar-md"] = entry;
  const after = JSON.stringify(servers["sidebar-md"]);

  const next = { ...base, mcpServers: servers };
  const action: InitOutcome["action"] =
    existing === null ? "created" : before === after ? "unchanged" : "updated";

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { path, action, agents: Object.keys(servers).sort() };
}
