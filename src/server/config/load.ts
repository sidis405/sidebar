import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ZodError, ZodSchema } from "zod";
import { BUILTIN_AGENT_VERB_NAMES, BUILTIN_HUMAN_VERB_NAMES } from "../verbs/builtin.js";
import { CONFIG_REL, LOCAL_REL, configPath, localPath } from "./paths.js";
import {
  type SidebarConfigFile,
  type SidebarLocalFile,
  sidebarConfigSchema,
  sidebarLocalSchema,
} from "./schema.js";

// ConfigLoadError carries enough context for the CLI to print a one-line
// "<file>: <field>: <reason>" message. The Q9 stance is firm: no silent
// fallback. If we get a load error, sidebar refuses to start.
export class ConfigLoadError extends Error {
  constructor(
    /** Relative path of the offending file (".sidebar/config.json"). */
    readonly file: string,
    /** Dotted field path (e.g. "verbs.human.rephrase"); empty for whole-file errors. */
    readonly fieldPath: string,
    /** Human-readable explanation. */
    readonly reason: string,
  ) {
    super(fieldPath ? `${file}: ${fieldPath}: ${reason}` : `${file}: ${reason}`);
    this.name = "ConfigLoadError";
  }
}

export type LoadConfigResult = {
  config: SidebarConfigFile | null;
  local: SidebarLocalFile | null;
};

export async function loadProjectConfig(cwd: string): Promise<LoadConfigResult> {
  const config = await loadOne<SidebarConfigFile>(configPath(cwd), CONFIG_REL, sidebarConfigSchema);
  if (config) assertNoBuiltinVerbRedefinition(config);
  const local = await loadOne<SidebarLocalFile>(localPath(cwd), LOCAL_REL, sidebarLocalSchema);
  return { config, local };
}

// Spec: Configuration -- "Redefining a built-in verb is a load error."
// We run this after schema parsing so the error path can name the specific
// verb the user wrote (e.g. "verbs.human.rephrase") rather than the parent
// record.
function assertNoBuiltinVerbRedefinition(config: SidebarConfigFile): void {
  const human = config.verbs?.human;
  if (human) {
    for (const name of Object.keys(human)) {
      if (BUILTIN_HUMAN_VERB_NAMES.has(name)) {
        throw new ConfigLoadError(
          CONFIG_REL,
          `verbs.human.${name}`,
          `cannot redefine built-in human verb '${name}'`,
        );
      }
    }
  }
  const agent = config.verbs?.agent;
  if (agent) {
    for (const name of Object.keys(agent)) {
      if (BUILTIN_AGENT_VERB_NAMES.has(name)) {
        throw new ConfigLoadError(
          CONFIG_REL,
          `verbs.agent.${name}`,
          `cannot redefine built-in agent verb '${name}'`,
        );
      }
    }
  }
}

async function loadOne<T>(
  absPath: string,
  relName: string,
  schema: ZodSchema<T>,
): Promise<T | null> {
  if (!existsSync(absPath)) return null;
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (e) {
    // Race: file existed at existsSync, gone (or unreadable) now. Surface as
    // a load error rather than silently treating it as absent.
    throw new ConfigLoadError(relName, "", `failed to read: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigLoadError(relName, "", `invalid JSON (${(e as Error).message})`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw zodToLoadError(relName, result.error);
  }
  return result.data;
}

function zodToLoadError(file: string, err: ZodError): ConfigLoadError {
  // Pick the most actionable issue. Zod returns one per offending field; for
  // strict-mode unknown keys it returns `unrecognized_keys` with `keys` on
  // the issue. Surface the first one with a normalized path.
  const issue = err.issues[0];
  if (!issue) return new ConfigLoadError(file, "", err.message);
  let path = issue.path.map((p) => String(p)).join(".");
  let reason = issue.message;
  if (issue.code === "unrecognized_keys") {
    const keys = (issue as unknown as { keys?: string[] }).keys ?? [];
    if (keys.length > 0) {
      // Surface the offending key in the dotted path so error messages name
      // the field the user actually wrote.
      path = path ? `${path}.${keys[0]}` : keys[0];
      reason = `unknown key '${keys[0]}'`;
    }
  }
  if (issue.code === "invalid_value" && path === "version") {
    // Zod literal mismatch is the V2 migration hook; the default message
    // ("Invalid input: expected 1") reads poorly. Override.
    reason = "version must be 1 (V2 migration hook; other values rejected)";
  }
  return new ConfigLoadError(file, path, reason);
}
