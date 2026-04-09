type ModelCapabilities = {
  temperature?: boolean
  [key: string]: unknown
}

type ModelInfo = {
  modelID?: string
  capabilities?: ModelCapabilities
  [key: string]: unknown
}

type ChatParamsInput = {
  sessionID: string
  agent: string
  model: ModelInfo
  provider: unknown
  message: unknown
}

type ChatParamsOutput = {
  temperature: number
  topP: number
  top_p?: number
  topK: number
  maxOutputTokens: number | undefined
  options: Record<string, unknown>
}

/**
 * Sanitize LLM sampling parameters to avoid API rejections.
 *
 * Two classes of problems are addressed:
 *
 * 1. **Model does not support temperature** — Reasoning models (o1/o3/o4-mini,
 *    Claude thinking, etc.) report `capabilities.temperature === false`.
 *    For these models we strip both `temperature` and `topP`/`top_p` because
 *    the provider will reject the request if either is present.
 *
 * 2. **temperature and top_p both present** — Some providers (e.g. certain
 *    OpenAI endpoints) refuse requests that set both simultaneously.
 *    We keep `temperature` (the more commonly configured knob) and drop `topP`.
 *
 * This hook runs for every LLM call — main agent and subagents alike — so it
 * covers the child-session path that previously caused
 * "`temperature` and `top_p` cannot both be specified" errors.
 */
export function createChatParamsHook() {
  return async (input: ChatParamsInput, output: ChatParamsOutput): Promise<void> => {
    const out = output as Record<string, unknown>

    // --- Case 1: model does not accept temperature at all ---
    const supportsTemperature = input.model?.capabilities?.temperature !== false
    if (!supportsTemperature) {
      delete out.temperature
      delete out.topP
      delete out.top_p
      return
    }

    // --- Case 2: both temperature and topP/top_p are present ---
    const hasTemperature = out.temperature !== undefined
    const hasTopP = out.topP !== undefined || out.top_p !== undefined
    if (hasTemperature && hasTopP) {
      delete out.topP
      delete out.top_p
    }
  }
}
