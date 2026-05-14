import type { SidebarConfigFile } from "../config/schema.js";
import {
  type AgentVerb,
  BUILTIN_AGENT_VERBS,
  BUILTIN_HUMAN_VERBS,
  type HumanVerb,
} from "./builtin.js";

// VerbCatalog is the shape slices 4-6 consume to validate verb references
// pulled from disk markers and from agent MCP calls. Keep it small and
// stable; changes here ripple through every downstream slice.
export type VerbCatalog = {
  human: Map<string, HumanVerb>;
  agent: Map<string, AgentVerb>;
};

export function buildVerbCatalog(config: SidebarConfigFile | null): VerbCatalog {
  const human = new Map<string, HumanVerb>();
  for (const v of BUILTIN_HUMAN_VERBS) human.set(v.name, { ...v });
  const agent = new Map<string, AgentVerb>();
  for (const v of BUILTIN_AGENT_VERBS) agent.set(v.name, { ...v });

  const verbs = config?.verbs;
  if (verbs?.human) {
    for (const [name, def] of Object.entries(verbs.human)) {
      // Redefining built-ins is rejected at load time; if we got here the
      // input has already been validated.
      human.set(name, { name, mode: def.mode, builtin: false });
    }
  }
  if (verbs?.agent) {
    for (const name of Object.keys(verbs.agent)) {
      agent.set(name, { name, builtin: false });
    }
  }

  return { human, agent };
}
