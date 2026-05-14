import { createHash } from "node:crypto";

// Stable content hash used for optimistic concurrency on save and as the
// `diskHash` value exposed to the editor.
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
