import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./log.js";

// `.sidebar/connection.json` is the per-project discovery file. The primary
// instance writes it on boot and removes it on graceful shutdown. A second
// `--stdio` invocation reads it to decide between primary and proxy.
// See spec: Form Factor / `.sidebar/connection.json`.

export type ConnectionInfo = {
  version: 1;
  url: string;
  pid: number;
  started_at: string;
};

export function connectionFilePath(cwd: string): string {
  return join(cwd, ".sidebar", "connection.json");
}

export async function writeConnectionFile(cwd: string, info: ConnectionInfo): Promise<void> {
  await mkdir(join(cwd, ".sidebar"), { recursive: true });
  // `writeFile` with the default flag is fine here: the file is process-local
  // discovery, not configuration. A stale file is intentionally overwritten.
  await writeFile(connectionFilePath(cwd), `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

export async function removeConnectionFile(cwd: string): Promise<void> {
  try {
    await unlink(connectionFilePath(cwd));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`failed to remove connection.json: ${(e as Error).message}`);
    }
  }
}

export type ConnectionProbe =
  | { kind: "absent" }
  | { kind: "stale"; info: ConnectionInfo }
  | { kind: "malformed" }
  | { kind: "alive"; info: ConnectionInfo };

export async function probeConnectionFile(cwd: string): Promise<ConnectionProbe> {
  const path = connectionFilePath(cwd);
  if (!existsSync(path)) return { kind: "absent" };
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { kind: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "malformed" };
  }
  if (!isConnectionInfo(parsed)) return { kind: "malformed" };
  if (isPidAlive(parsed.pid)) return { kind: "alive", info: parsed };
  return { kind: "stale", info: parsed };
}

function isConnectionInfo(v: unknown): v is ConnectionInfo {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    c.version === 1 &&
    typeof c.url === "string" &&
    typeof c.pid === "number" &&
    typeof c.started_at === "string"
  );
}

// `process.kill(pid, 0)` does not send a signal; it only checks reachability.
// Throws ESRCH for dead pids and EPERM if the caller lacks permission (in
// which case the pid is still alive — treat that as "alive" so we never race
// a foreign primary into a duplicate bind).
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
