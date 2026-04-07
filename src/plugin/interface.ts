import type { Plugin } from "@opencode-ai/plugin"

import type { OhMyCCAgentConfig } from "../config/schema"

import { createChatMessageHook } from "../hooks/chat-message"
import { createChatParamsHook } from "../hooks/chat-params"
import { createCompactionHook } from "../hooks/compaction"
import { createConfigHook } from "../hooks/config-handler"
import { createDynamicSystemPrompt } from "../hooks/dynamic-system-prompt"
import { createEnvironmentContext } from "../hooks/environment-context"
import { createGitContextHook } from "../hooks/git-context"
import { createIdleCompactionHook, recordSessionTurn } from "../hooks/idle-compaction"
import { createMessageTransformHook } from "../hooks/message-transform"
import { createRiskGuard } from "../hooks/risk-guard"
import { createToolDefinitionHook } from "../hooks/tool-definition"
import { createVerificationReminder } from "../hooks/verification-reminder"
import { createAgentTools } from "./tool-registry"

type PluginContext = Parameters<Plugin>[0]
type PluginInstance = Awaited<ReturnType<Plugin>>

export type PluginInterface = Pick<
  PluginInstance,
  | "config"
  | "tool"
  | "tool.execute.before"
  | "tool.execute.after"
  | "event"
  | "chat.message"
  | "chat.params"
  | "tool.definition"
  | "experimental.chat.system.transform"
  | "experimental.chat.messages.transform"
  | "experimental.session.compacting"
>

export function createPluginInterface(args: {
  ctx: PluginContext
  config: OhMyCCAgentConfig
}): PluginInterface {
  const { ctx, config } = args

  const configHook = createConfigHook(config, ctx.directory)
  const riskGuard = createRiskGuard(config)
  const verificationReminder = createVerificationReminder(config)
  const environmentContext = createEnvironmentContext(ctx.directory)
  const gitContext = createGitContextHook(ctx.directory)
  const dynamicSystemPrompt = createDynamicSystemPrompt(config, ctx.directory)
  const chatMessageHook = createChatMessageHook(config)
  const chatParamsHook = createChatParamsHook()
  const compactionHook = createCompactionHook()
  const toolDefinitionHook = createToolDefinitionHook()
  const messageTransformHook = createMessageTransformHook()
  const idleCompaction = createIdleCompactionHook(config, ctx.client)

  return {
    config: configHook,
    tool: createAgentTools(config),

    "tool.execute.before": riskGuard,

    "tool.execute.after": async (input, output) => {
      await verificationReminder(input, output)
    },

    event: async (input) => {
      await environmentContext(input, {})
      await gitContext(input, {})
      const rawEvent = (input as Record<string, unknown>).event as Record<string, unknown> | undefined
      if (rawEvent) {
        await idleCompaction.onEvent(rawEvent as { type: string; properties?: { sessionID?: string } })
      }
    },

    "chat.message": async (input, output) => {
      await chatMessageHook(input, output)
      if (input.sessionID) {
        recordSessionTurn(input.sessionID)
        await idleCompaction.onChatMessage(input.sessionID)
      }
    },
    "chat.params": chatParamsHook,
    "tool.definition": toolDefinitionHook,
    "experimental.chat.system.transform": dynamicSystemPrompt,
    "experimental.chat.messages.transform": messageTransformHook,
    "experimental.session.compacting": compactionHook,
  }
}
