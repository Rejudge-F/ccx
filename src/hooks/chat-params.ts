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
  topK: number
  options: Record<string, unknown>
}

const AGENT_PARAMS: Record<string, Partial<ChatParamsOutput>> = {
  "ccx-plan": { temperature: 0.3 },
  "ccx-verification": { temperature: 0.2 },
  "ccx-explore": { temperature: 0.5 },
  "ccx-coordinator": { temperature: 0.4 },
  "ccx-general-purpose": { temperature: 0.5 },
}

export function createChatParamsHook() {
  return async (input: ChatParamsInput, output: ChatParamsOutput): Promise<void> => {
    const agentParams = AGENT_PARAMS[input.agent]
    if (!agentParams) return

    if (agentParams.temperature !== undefined) output.temperature = agentParams.temperature
    if (agentParams.topP !== undefined) output.topP = agentParams.topP
    if (agentParams.topK !== undefined) output.topK = agentParams.topK
  }
}
