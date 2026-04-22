import { z } from "zod"

const verificationSchema = z.object({
  auto_remind: z.boolean().default(true),
  enforce_contract: z.boolean().default(true),
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

const compactionSchema = z.object({
  // When true, ccx fully replaces the default compaction prompt with a
  // structured 9-section template (analysis scratchpad + no-tools guard).
  // When false (legacy), ccx only appends preservation bullets to the context.
  replace_prompt: z.boolean().default(true),
  // Enforce a "text only, no tool calls" guard in the compaction prompt.
  // Only takes effect when replace_prompt is true.
  no_tools_guard: z.boolean().default(true),
})

const toneStyleSchema = z.object({
  // Claude Code reports ~1.2% output-token reduction from explicit numeric
  // length anchors vs qualitative "be concise" prose. Disable if the anchors
  // clash with an output style that prefers longer explanations.
  numeric_length_anchors: z.boolean().default(true),
  // Cap between-tool narration (words). Final responses may still be longer
  // when the task genuinely requires more detail.
  max_words_between_tools: z.int().positive().default(25),
  // Cap the final user-facing response (words). The anchor is a soft guide;
  // the prompt tells the model to exceed it only when detail is required.
  max_words_final_response: z.int().positive().default(100),
})

const outputEfficiencySchema = z.object({
  // "prose" = the Claude-Ant-style detailed writing guide (reader-first,
  //           inverted pyramid, no semantic backtracking). Use when
  //           user-facing prose quality matters.
  // "concise" = the external-Claude-Code brief style (lead with action,
  //             skip filler). Good default.
  // "off" = omit the section entirely (tone-style alone governs).
  mode: z.enum(["prose", "concise", "off"]).default("concise"),
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
    auto_remind: true,
    enforce_contract: true,
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
  compaction: compactionSchema.default({
    replace_prompt: true,
    no_tools_guard: true,
  }),
  tone_style: toneStyleSchema.default({
    numeric_length_anchors: true,
    max_words_between_tools: 25,
    max_words_final_response: 100,
  }),
  output_efficiency: outputEfficiencySchema.default({
    mode: "concise",
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
