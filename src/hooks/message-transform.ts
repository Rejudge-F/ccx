type MessageInfo = {
  info: { role: string; [key: string]: unknown }
  parts: Array<{ type: string; text?: string; output?: string; tool?: string; [key: string]: unknown }>
}

const MAX_TOOL_OUTPUT_LENGTH = 8000
const TOOL_OUTPUT_TRIM_TO = 4000
const KEEP_RECENT_TOOL_OUTPUTS = 5
const CLEARABLE_TOOLS = new Set(["read", "grep", "glob", "bash", "webfetch"])
const CLEARED_MARKER = "[Old tool result content cleared]"

function microcompactOldToolOutputs(messages: MessageInfo[]) {
  const toolParts: Array<{ part: MessageInfo["parts"][number]; index: number }> = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      const toolName = typeof part.tool === "string" ? part.tool.toLowerCase() : ""
      if (!CLEARABLE_TOOLS.has(toolName)) continue
      if (typeof part.output !== "string" || part.output === CLEARED_MARKER) continue
      toolParts.push({ part, index: i })
    }
  }

  const clearCount = toolParts.length - KEEP_RECENT_TOOL_OUTPUTS
  if (clearCount <= 0) return

  for (let i = 0; i < clearCount; i++) {
    toolParts[i].part.output = CLEARED_MARKER
  }
}

function trimLongToolOutputs(messages: MessageInfo[]) {
  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type !== "tool") continue

      const output = typeof part.output === "string" ? part.output : undefined
      if (output && output.length > MAX_TOOL_OUTPUT_LENGTH) {
        const head = output.slice(0, TOOL_OUTPUT_TRIM_TO / 2)
        const tail = output.slice(-TOOL_OUTPUT_TRIM_TO / 2)
        const trimmed = output.length - TOOL_OUTPUT_TRIM_TO
        part.output = `${head}\n\n... [${trimmed} characters trimmed] ...\n\n${tail}`
      }
    }
  }
}

function collapseConsecutiveReasoningParts(messages: MessageInfo[]) {
  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue
    const collapsed: typeof msg.parts = []
    for (const part of msg.parts) {
      if (
        part.type === "reasoning" &&
        collapsed.length > 0 &&
        collapsed[collapsed.length - 1].type === "reasoning"
      ) {
        continue
      }
      collapsed.push(part)
    }
    msg.parts = collapsed
  }
}

let microcompactEnabled = false

export function enableMicrocompact() {
  microcompactEnabled = true
}

export function createMessageTransformHook() {
  return async (
    _input: Record<string, unknown>,
    output: { messages: MessageInfo[] },
  ): Promise<void> => {
    if (microcompactEnabled) {
      microcompactOldToolOutputs(output.messages)
      microcompactEnabled = false
    }
    trimLongToolOutputs(output.messages)
    collapseConsecutiveReasoningParts(output.messages)
  }
}
