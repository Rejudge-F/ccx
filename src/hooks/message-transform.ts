type MessageInfo = {
  info: { role: string; [key: string]: unknown }
  parts: Array<{ type: string; text?: string; output?: string; [key: string]: unknown }>
}

const MAX_TOOL_OUTPUT_LENGTH = 8000
const TOOL_OUTPUT_TRIM_TO = 4000

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

export function createMessageTransformHook() {
  return async (
    _input: Record<string, unknown>,
    output: { messages: MessageInfo[] },
  ): Promise<void> => {
    trimLongToolOutputs(output.messages)
    collapseConsecutiveReasoningParts(output.messages)
  }
}
