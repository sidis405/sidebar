import { randomBytes } from "node:crypto";

// Spec / slice-4 design: stable, never-recomputed marker ids. Generated once
// at creation time (here) from crypto.randomBytes encoded in base36 to a
// short ~4-character body. We pick the prefix by marker type so a glance at
// the on-disk file tells you what kind of marker carries the id:
//
//   m-xxxx  mention   (this slice)
//   n-xxxx  note      (slice 5)
//   s-xxxx  suggestion (slice 5)
//
// Duplicate ids in a file are a malformed-marker defect, not an auto-rename
// trigger. The id is independent of the marker's content; content can change
// underneath while the marker is open and the id stays constant.

const ID_BODY_BYTES = 3; // -> roughly 4 base36 chars

export function generateMentionId(): string {
  return `m-${randomChunk()}`;
}

export function generateNoteId(): string {
  return `n-${randomChunk()}`;
}

export function generateSuggestionId(): string {
  return `s-${randomChunk()}`;
}

function randomChunk(): string {
  const buf = randomBytes(ID_BODY_BYTES);
  let n = 0;
  for (let i = 0; i < buf.length; i++) n = (n << 8) | buf[i];
  return n.toString(36).padStart(4, "0").slice(-6);
}
