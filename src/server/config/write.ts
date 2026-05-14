import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { appendLocalToGitignore, isLocalIgnored } from "./gitignore.js";
import { CONFIG_REL, LOCAL_REL, configPath, localPath, sidebarDir } from "./paths.js";
import {
  type SidebarConfigFile,
  type SidebarLocalFile,
  sidebarConfigSchema,
  sidebarLocalSchema,
} from "./schema.js";

// Lazy writers for .sidebar/config.json and .sidebar/local.json. Each is the
// single hook future slices use to persist a setting: calling persistLocal
// from a "save settings" UI handler triggers the .sidebar/ dir, the file, and
// the gitignore offer. Until a slice calls one of these, .sidebar/{config,
// local}.json never appears on disk.

export type GitignoreConsent = (info: { gitignorePath: string }) => Promise<boolean> | boolean;

export type GitignoreAction =
  /** No `.git/` directory at `cwd`; we don't manage gitignore in that case. */
  | "absent"
  /** local.json is already ignored; no-op. */
  | "already-ignored"
  /** Consent was granted and the line was appended (or .gitignore was created). */
  | "appended"
  /** Consent callback returned false; we proceed without touching .gitignore. */
  | "declined"
  /** No consent callback provided; we proceed without prompting. */
  | "no-prompt";

export type PersistLocalResult = {
  /** True when local.json did not exist before this write. */
  created: boolean;
  gitignoreAction: GitignoreAction;
};

export type PersistConfigResult = {
  created: boolean;
};

export async function persistLocal(
  cwd: string,
  patch: Partial<Omit<SidebarLocalFile, "version">>,
  opts: { consent?: GitignoreConsent } = {},
): Promise<PersistLocalResult> {
  const path = localPath(cwd);
  const existed = existsSync(path);
  const previous: SidebarLocalFile | null = existed
    ? await readAndValidate(path, sidebarLocalSchema)
    : null;

  const next: SidebarLocalFile = {
    version: 1,
    ...(previous ?? {}),
    ...patch,
  };
  // Re-validate the merged result so a writer cannot create a file the
  // loader would reject. Catches e.g. callers slipping in a bad port.
  const validated = sidebarLocalSchema.parse(next);

  await mkdir(sidebarDir(cwd), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");

  // gitignore offer only fires on creation, per the spec ("On creation of
  // .sidebar/local.json, sidebar checks for a .git/ directory ...").
  let gitignoreAction: GitignoreAction = "no-prompt";
  if (!existed) {
    gitignoreAction = await runGitignoreOffer(cwd, opts.consent);
  } else {
    // For an update, "no-prompt" is the right answer regardless of the
    // current ignore state — we don't re-offer.
    gitignoreAction = "no-prompt";
  }
  return { created: !existed, gitignoreAction };
}

export async function persistConfig(
  cwd: string,
  patch: Partial<Omit<SidebarConfigFile, "version">>,
): Promise<PersistConfigResult> {
  const path = configPath(cwd);
  const existed = existsSync(path);
  const previous: SidebarConfigFile | null = existed
    ? await readAndValidate(path, sidebarConfigSchema)
    : null;

  const next: SidebarConfigFile = {
    version: 1,
    ...(previous ?? {}),
    ...patch,
  };
  const validated = sidebarConfigSchema.parse(next);

  await mkdir(sidebarDir(cwd), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return { created: !existed };
}

async function runGitignoreOffer(
  cwd: string,
  consent: GitignoreConsent | undefined,
): Promise<GitignoreAction> {
  if (!existsSync(`${cwd}/.git`)) return "absent";
  if (isLocalIgnored(cwd)) return "already-ignored";
  if (!consent) return "no-prompt";
  const ok = await consent({ gitignorePath: `${cwd}/.gitignore` });
  if (!ok) return "declined";
  await appendLocalToGitignore(cwd);
  return "appended";
}

// Read + validate a file we are about to merge into. This is the writer-side
// equivalent of loadProjectConfig; using the same schema keeps writers from
// "fixing" a previously invalid file silently.
async function readAndValidate<T>(path: string, schema: { parse: (v: unknown) => T }): Promise<T> {
  const raw = await readFile(path, "utf8");
  return schema.parse(JSON.parse(raw));
}

// Re-export the file-paths constants for callers that want to surface the
// path in their own UI text.
export { CONFIG_REL, LOCAL_REL };
