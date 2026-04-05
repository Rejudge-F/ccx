import type { Plugin } from "@opencode-ai/plugin"

import type { OhMyCCAgentConfig } from "../config/schema"

import { createConfigHook } from "../hooks/config-handler"
import { createEnvironmentContext } from "../hooks/environment-context"
import { createRiskGuard } from "../hooks/risk-guard"
import { createVerificationReminder } from "../hooks/verification-reminder"
import { createAgentTools } from "./tool-registry"

type PluginContext = Parameters<Plugin>[0]
type PluginInstance = Awaited<ReturnType<Plugin>>

export type PluginInterface = Pick<
  PluginInstance,
  "config" | "tool" | "tool.execute.before" | "tool.execute.after" | "event"
>

export function createPluginInterface(args: {
  ctx: PluginContext
  config: OhMyCCAgentConfig
}): PluginInterface {
  const { ctx, config } = args

  const configHook = createConfigHook(config, ctx.directory)
  const riskGuard = createRiskGuard()
  const verificationReminder = createVerificationReminder(config)
  const environmentContext = createEnvironmentContext(ctx.directory)

  return {
    config: configHook,
    tool: createAgentTools(),
    "tool.execute.before": riskGuard,
    "tool.execute.after": verificationReminder,
    event: async (input) => {
      await environmentContext(input, {})
    },
  }
}
