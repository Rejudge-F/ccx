type ChatParamsInput = {
  sessionID: string
  agent: string
  model: { modelID?: string; [key: string]: unknown }
  provider: unknown
  message: unknown
}

type ChatParamsOutput = {
  temperature: number
  topP: number
  top_p?: number
  topK: number
  options: Record<string, unknown>
}

export function createChatParamsHook() {
  return async (_input: ChatParamsInput, output: ChatParamsOutput): Promise<void> => {
    const out = output as Record<string, unknown>
    const hasTemperature = out.temperature !== undefined
    const hasTopP = out.topP !== undefined || out.top_p !== undefined
    const hasBoth = hasTemperature && hasTopP
    if (hasBoth) {
      delete out.topP
      delete out.top_p
    }
  }
}
