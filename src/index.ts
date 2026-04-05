import type { Plugin } from "@opencode-ai/plugin"

import { loadConfig } from "./config/loader"
import { createPluginInterface } from "./plugin/interface"

const CCX: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory)
  const pluginInterface = createPluginInterface({ ctx, config })

  return {
    name: "ccx",
    ...pluginInterface,
  }
}

export default CCX

export type { OhMyCCAgentConfig } from "./config/schema"
