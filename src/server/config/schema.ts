import { z } from "zod";
import { VERB_NAME_PATTERN } from "../verbs/builtin.js";

// .sidebar/config.json — committed, team-shared. Spec: Configuration /
// `.sidebar/config.json`. Strict object schema: unknown keys reject.
//
// .sidebar/local.json — gitignored, per-machine. Spec: Configuration /
// `.sidebar/local.json`. Strict object schema: unknown keys reject.
//
// Built-in-verb redefinition is enforced in load.ts after schema parsing so
// the error message can name the offending verb in its dotted path; zod's
// per-record-key refinement is awkward to thread cleanly here.

const verbNameSchema = z
  .string()
  .regex(VERB_NAME_PATTERN, "verb name must match /^[a-z][a-z0-9-]*$/");

const humanVerbBodySchema = z
  .object({
    mode: z.enum(["replace", "annotation"]),
  })
  .strict();

const agentVerbBodySchema = z.object({}).strict();

const verbsSchema = z
  .object({
    human: z.record(verbNameSchema, humanVerbBodySchema).optional(),
    agent: z.record(verbNameSchema, agentVerbBodySchema).optional(),
  })
  .strict();

export const sidebarConfigSchema = z
  .object({
    version: z.literal(1, {
      message: "version must be 1 (V2 migration hook; other values rejected)",
    }),
    scope: z.string().min(1).optional(),
    rateLimit: z
      .object({
        agentMentions: z
          .object({
            maxOpen: z.number().int().min(0).max(1000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    verbs: verbsSchema.optional(),
  })
  .strict();

export const sidebarLocalSchema = z
  .object({
    version: z.literal(1, {
      message: "version must be 1 (V2 migration hook; other values rejected)",
    }),
    port: z.number().int().min(0).max(65_535).optional(),
    browser: z.string().min(1).optional(),
  })
  .strict();

export type SidebarConfigFile = z.infer<typeof sidebarConfigSchema>;
export type SidebarLocalFile = z.infer<typeof sidebarLocalSchema>;
