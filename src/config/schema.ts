import { z } from "zod"

const verificationSchema = z.object({
  auto_remind: z.boolean().default(false),
  enforce_contract: z.boolean().default(false),
  min_file_edits: z.int().nonnegative().default(3),
  spot_check_min_commands: z.int().positive().default(2),
})

const riskGuardSchema = z.object({
  enforce_high_risk_confirmation: z.boolean().default(true),
})

const subagentOrchestrationSchema = z.object({
  explore_min_queries: z.int().positive().default(3),
  coordinator_enabled: z.boolean().default(false),
  allow_subagent_delegation: z.boolean().default(false),
})

export const configSchema = z.object({
  enabled: z.boolean().default(true),
  disabled_sections: z.array(z.string()).default([]),
  disabled_hooks: z.array(z.string()).default([]),
  output_style: z.string().min(1).nullable().default(null),
  verification: verificationSchema.default({
    auto_remind: false,
    enforce_contract: false,
    min_file_edits: 3,
    spot_check_min_commands: 2,
  }),
  risk_guard: riskGuardSchema.default({
    enforce_high_risk_confirmation: true,
  }),
  subagent_orchestration: subagentOrchestrationSchema.default({
    explore_min_queries: 3,
    coordinator_enabled: false,
    allow_subagent_delegation: false,
  }),
})

export type OhMyCCAgentConfig = z.infer<typeof configSchema>
