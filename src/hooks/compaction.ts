export function createCompactionHook() {
  return async (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ): Promise<void> => {
    output.context.push(
      "IMPORTANT: When summarizing this conversation, you MUST preserve the following:",
      "1. The original user task/request and any refinements",
      "2. The implementation plan if one was created",
      "3. All file paths that were edited, created, or deleted",
      "4. The current verification status (PASS/FAIL/PARTIAL) if verification was run",
      "5. Any unresolved issues, blockers, or pending decisions",
      "6. Key architectural decisions and their rationale",
      "7. The names of any subagents that were dispatched and their outcomes",
      "Do NOT summarize tool outputs verbatim — capture only the conclusions and any error messages.",
    )
  }
}
