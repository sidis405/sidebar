// Built-in verb tables. Spec: Verbs (V1 Defaults).
//
// Both tables are load-bearing across slices 4-6 (mention lifecycle,
// annotation creation, agent-origin mentions). Redefining any entry from
// .sidebar/config.json is a load error; slice 03 enforces that at validation
// time so downstream slices can trust the catalog.

export type HumanVerbMode = "replace" | "annotation";

export type HumanVerb = {
  name: string;
  mode: HumanVerbMode;
  /** True for entries in this file; false for verbs added via config.json. */
  builtin: boolean;
};

export type AgentVerb = {
  name: string;
  builtin: boolean;
};

export const BUILTIN_HUMAN_VERBS: ReadonlyArray<HumanVerb> = [
  { name: "rephrase", mode: "replace", builtin: true },
  { name: "expand", mode: "replace", builtin: true },
  { name: "shorten", mode: "replace", builtin: true },
  { name: "remove-if-redundant", mode: "replace", builtin: true },
  { name: "factcheck", mode: "annotation", builtin: true },
  { name: "question", mode: "annotation", builtin: true },
  { name: "review", mode: "annotation", builtin: true },
  { name: "explain", mode: "annotation", builtin: true },
];

export const BUILTIN_AGENT_VERBS: ReadonlyArray<AgentVerb> = [
  { name: "clarify", builtin: true },
  { name: "decide", builtin: true },
  { name: "confirm", builtin: true },
  { name: "review", builtin: true },
];

export const BUILTIN_HUMAN_VERB_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_HUMAN_VERBS.map((v) => v.name),
);

export const BUILTIN_AGENT_VERB_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_AGENT_VERBS.map((v) => v.name),
);

// Spec: Configuration -- "Verb names must match [a-z][a-z0-9-]*".
export const VERB_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
