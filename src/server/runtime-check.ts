// Per ADR-0008, sidebar targets Node 20 LTS or later. Older runtimes refuse
// to start with a clear error rather than failing on a missing API later.
export function assertNodeVersion(version: string): void {
  const match = version.match(/^v?(\d+)/);
  const major = match ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(
      `sidebar requires Node 20 or newer (got ${version}). Update Node and try again.`,
    );
  }
}
