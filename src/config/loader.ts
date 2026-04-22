import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { OhMyCCAgentConfig } from "./schema"

import { configSchema } from "./schema"

const CONFIG_RELATIVE_PATH = join(".opencode", "ccx.json")

function stripJsonComments(content: string): string {
  let result = ""
  let quote: '"' | "'" | null = null
  let escaping = false

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index]
    const next = content[index + 1]

    if (quote !== null) {
      result += current
      if (escaping) {
        escaping = false
      } else if (current === "\\") {
        escaping = true
      } else if (current === quote) {
        quote = null
      }
      continue
    }

    if (current === '"' || current === "'") {
      quote = current
      result += current
      continue
    }

    if (current === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") {
        index += 1
      }
      if (index < content.length) {
        result += "\n"
      }
      continue
    }

    if (current === "/" && next === "*") {
      index += 2
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          index += 1
          break
        }
        index += 1
      }
      continue
    }

    result += current
  }

  return result
}

function readConfigFile(filePath: string): OhMyCCAgentConfig | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const raw = readFileSync(filePath, "utf8")
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown
    return configSchema.parse(parsed)
  } catch (error) {
    console.error(`[ccx] Failed to load config from ${filePath}`, error)
    return null
  }
}

export function loadConfig(directory: string): OhMyCCAgentConfig {
  const defaults = configSchema.parse({})
  const projectConfigPath = join(directory, CONFIG_RELATIVE_PATH)
  const userConfigPath = join(homedir(), ".config", "opencode", "ccx.json")

  const loaded = readConfigFile(projectConfigPath) ?? readConfigFile(userConfigPath) ?? defaults
  return resolveAgentNameDerivedDefaults(loaded)
}

/**
 * Fill in slash-command defaults that are derived from `agent_name` when the
 * user didn't pick an explicit value. This lets `agent_name: "delta"` rename
 * /ccx-fork -> /delta-fork automatically.
 */
function resolveAgentNameDerivedDefaults(config: OhMyCCAgentConfig): OhMyCCAgentConfig {
  const { agent_name } = config
  const sw = config.subagent_orchestration.session_workflows

  return {
    ...config,
    subagent_orchestration: {
      ...config.subagent_orchestration,
      session_workflows: {
        ...sw,
        fork_command: sw.fork_command ?? `/${agent_name}-fork`,
        background_command: sw.background_command ?? `/${agent_name}-bg`,
        full_context_command: sw.full_context_command ?? `/${agent_name}-fullctx`,
        status_command: sw.status_command ?? `/${agent_name}-bg-status`,
      },
    },
  }
}
