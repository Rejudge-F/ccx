import type { OhMyCCAgentConfig } from "../config/schema"
import {
  BASH_HINTS,
  EDIT_HINTS,
  GLOB_HINTS,
  GREP_HINTS,
  READ_HINTS,
  TASK_HINTS,
  TODOWRITE_HINTS,
  WEBFETCH_HINTS,
  WRITE_HINTS,
} from "../prompts/tool-hints"

const TOOL_HINTS: Record<string, string> = {
  bash: BASH_HINTS,
  shell: BASH_HINTS,
  sh: BASH_HINTS,
  exec: BASH_HINTS,
  read: READ_HINTS,
  edit: EDIT_HINTS,
  fileedit: EDIT_HINTS,
  file_edit: EDIT_HINTS,
  write: WRITE_HINTS,
  filewrite: WRITE_HINTS,
  file_write: WRITE_HINTS,
  glob: GLOB_HINTS,
  grep: GREP_HINTS,
  webfetch: WEBFETCH_HINTS,
  web_fetch: WEBFETCH_HINTS,
  fetch: WEBFETCH_HINTS,
  task: TASK_HINTS,
  todowrite: TODOWRITE_HINTS,
  todo_write: TODOWRITE_HINTS,
}

const HINT_MARKER = "<!-- ccx-tool-hints -->"

export function createToolDefinitionHook(config: OhMyCCAgentConfig) {
  return async (
    input: { toolID: string },
    output: { description: string; parameters: unknown },
  ): Promise<void> => {
    if (!config.tool_hints.enabled) return
    const toolName = input.toolID.toLowerCase()
    if (config.tool_hints.disabled_tools.map((t) => t.toLowerCase()).includes(toolName)) return

    const hint = TOOL_HINTS[toolName]
    if (!hint) return

    if (output.description.includes(HINT_MARKER)) return

    output.description = `${output.description}\n\n${HINT_MARKER}\n\n${hint}`
  }
}
