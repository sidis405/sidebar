import { join, relative } from "node:path";

export const SIDEBAR_DIR = ".sidebar";
export const CONFIG_FILE = "config.json";
export const LOCAL_FILE = "local.json";

// Relative form used in user-visible error messages so they stay short and
// portable: ".sidebar/local.json" reads the same on every platform.
export const CONFIG_REL = `${SIDEBAR_DIR}/${CONFIG_FILE}`;
export const LOCAL_REL = `${SIDEBAR_DIR}/${LOCAL_FILE}`;

export function configPath(cwd: string): string {
  return join(cwd, SIDEBAR_DIR, CONFIG_FILE);
}

export function localPath(cwd: string): string {
  return join(cwd, SIDEBAR_DIR, LOCAL_FILE);
}

export function sidebarDir(cwd: string): string {
  return join(cwd, SIDEBAR_DIR);
}

// Relative form rooted at `cwd`. Used in error messages to make sure the
// reader can act on the path without hunting through tmp prefixes.
export function relFromCwd(cwd: string, abs: string): string {
  const r = relative(cwd, abs);
  // Replace any platform separator with posix; the rest of the codebase uses
  // posix in user-visible strings.
  return r.split(/[\\/]/).join("/");
}
