import { z } from "zod"

const verificationSchema = z.object({
  auto_remind: z.boolean().default(false),
  enforce_contract: z.boolean().default(false),
  min_file_edits: z.int().nonnegative().default(3),
  spot_check_min_commands: z.int().positive().default(2),
})

const riskGuardSchema = z.object({
  enforce_high_risk_confirmation: z.boolean().default(true),
  ast_analysis: z.boolean().default(true),
  extra_blocked_commands: z.array(z.string()).default([]),
  extra_allowed_commands: z.array(z.string()).default([]),
})

const ssrfGuardSchema = z.object({
  enabled: z.boolean().default(true),
  allow_loopback: z.boolean().default(true),
  extra_blocked_hosts: z.array(z.string()).default([]),
  extra_allowed_hosts: z.array(z.string()).default([]),
})

const projectInstructionsSchema = z.object({
  enabled: z.boolean().default(true),
  recursive: z.boolean().default(true),
  global_file: z.boolean().default(true),
  max_depth: z.int().positive().default(8),
  max_total_bytes: z.int().positive().default(64_000),
  filenames: z.array(z.string().min(1)).default([
    "CLAUDE.md",
    ".claude/instructions.md",
    "AGENTS.md",
  ]),
})

const toolHintsSchema = z.object({
  enabled: z.boolean().default(true),
  disabled_tools: z.array(z.string()).default([]),
})

const contextBundleSchema = z.object({
  enabled: z.boolean().default(true),
  include_cwd: z.boolean().default(true),
  include_git: z.boolean().default(true),
  include_recent_files: z.boolean().default(true),
  max_recent_files: z.int().nonnegative().default(8),
})

const sessionWorkflowsSchema = z.object({
  enabled: z.boolean().default(true),
  // `null` means "derive from agent_name" (e.g. agent_name=delta -> "/delta-fork").
  // An explicit string always wins.
  fork_command: z.string().min(1).nullable().default(null),
  background_command: z.string().min(1).nullable().default(null),
  full_context_command: z.string().min(1).nullable().default(null),
  status_command: z.string().min(1).nullable().default(null),
})

const subagentOrchestrationSchema = z.object({
  explore_min_queries: z.int().positive().default(3),
  coordinator_enabled: z.boolean().default(false),
  allow_subagent_delegation: z.boolean().default(false),
  context_bundle: contextBundleSchema.default({
    enabled: true,
    include_cwd: true,
    include_git: true,
    include_recent_files: true,
    max_recent_files: 8,
  }),
  session_workflows: sessionWorkflowsSchema.default({
    enabled: true,
    fork_command: null,
    background_command: null,
    full_context_command: null,
    status_command: null,
  }),
})

export const configSchema = z.object({
  enabled: z.boolean().default(true),
  // Name used for the primary agent, subagent prefix, and slash commands.
  // Defaults to "ccx"; set to e.g. "delta" to rebrand in the current workspace.
  // Must match opencode's agent-name rules (lowercase letters, digits, hyphens).
  agent_name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "agent_name must be lowercase kebab-case")
    .default("ccx"),
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
    ast_analysis: true,
    extra_blocked_commands: [],
    extra_allowed_commands: [],
  }),
  ssrf_guard: ssrfGuardSchema.default({
    enabled: true,
    allow_loopback: true,
    extra_blocked_hosts: [],
    extra_allowed_hosts: [],
  }),
  project_instructions: projectInstructionsSchema.default({
    enabled: true,
    recursive: true,
    global_file: true,
    max_depth: 8,
    max_total_bytes: 64_000,
    filenames: ["CLAUDE.md", ".claude/instructions.md", "AGENTS.md"],
  }),
  tool_hints: toolHintsSchema.default({
    enabled: true,
    disabled_tools: [],
  }),
  subagent_orchestration: subagentOrchestrationSchema.default({
    explore_min_queries: 3,
    coordinator_enabled: false,
    allow_subagent_delegation: false,
    context_bundle: {
      enabled: true,
      include_cwd: true,
      include_git: true,
      include_recent_files: true,
      max_recent_files: 8,
    },
    session_workflows: {
      enabled: true,
      fork_command: null,
      background_command: null,
      full_context_command: null,
      status_command: null,
    },
  }),
})

export type OhMyCCAgentConfig = z.infer<typeof configSchema>
