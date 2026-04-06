const TOOL_SAFETY_HINTS: Record<string, string> = {
  bash: "SAFETY: Before executing, verify the command is non-destructive. Never run rm -rf, git push --force, git reset --hard, DROP TABLE, or TRUNCATE TABLE without explicit user approval. Prefer --dry-run flags when available. Quote all file paths containing spaces.",
  edit: "SAFETY: Always read the file first before editing. Preserve existing indentation. Do not modify files you have not examined. Never edit .env files or credentials.",
  write: "SAFETY: Prefer editing existing files over creating new ones. Never write to .env or credential files. Avoid creating files in the workspace root unless they are permanent source code.",
}

const TOOL_CONTEXT_HINTS: Record<string, string> = {
  glob: "Use this for finding files by name pattern. Prefer this over bash find commands.",
  grep: "Use this for searching file contents by regex. Prefer this over bash grep/rg commands.",
  read: "Use this for reading file contents. Prefer this over bash cat/head/tail commands.",
}

export function createToolDefinitionHook() {
  return async (
    input: { toolID: string },
    output: { description: string; parameters: unknown },
  ): Promise<void> => {
    const toolName = input.toolID.toLowerCase()

    const safetyHint = TOOL_SAFETY_HINTS[toolName]
    if (safetyHint) {
      output.description = `${output.description}\n\n${safetyHint}`
    }

    const contextHint = TOOL_CONTEXT_HINTS[toolName]
    if (contextHint) {
      output.description = `${output.description}\n\n${contextHint}`
    }
  }
}
