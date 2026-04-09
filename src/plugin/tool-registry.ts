import type { OhMyCCAgentConfig } from "../config/schema"

/**
 * Subagent tools are no longer registered here.
 *
 * CCX subagents (ccx-explore, ccx-plan, ccx-verification, etc.) are registered
 * via the `config` hook in `config-handler.ts` with `mode: "subagent"`.
 * The upstream `task` tool dispatches them natively — creating a child session
 * whose progress streams in real time through the TUI.
 *
 * The previous approach registered lightweight wrapper tools (explore, plan, …)
 * that merely returned a text blob containing the agent's system prompt and the
 * user prompt. This had two problems:
 *   1. Results were not streamed — the caller only saw the final text return.
 *   2. The wrapper tools could shadow or conflict with the upstream `task` tool,
 *      causing the LLM to call the wrapper instead of the native task dispatch.
 *
 * By returning an empty tool map we let the upstream `task` tool handle all
 * subagent orchestration, which gives us real-time streaming, proper child-session
 * tracking, and SubtaskPart rendering in the TUI.
 */
export function createAgentTools(_config: OhMyCCAgentConfig): Record<string, never> {
  return {}
}
