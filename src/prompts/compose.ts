import { getActionsSection } from './actions.js'
import { getDoingTasksSection } from './doing-tasks.js'
import {
  getEnvironmentSection,
  type EnvironmentInfo as EnvInfo,
} from './environment.js'
import { getIntroSection } from './intro.js'
import { getOutputEfficiencySection } from './output-efficiency.js'
import { getSystemRulesSection } from './system-rules.js'
import { getToneStyleSection } from './tone-style.js'
import {
  getUsingToolsSection,
  type ToolSectionNames as ToolNames,
} from './using-tools.js'

export type { EnvInfo, ToolNames }

export function composeSystemPrompt(options: {
  toolNames: ToolNames
  env: EnvInfo
  outputStyle?: string
}): string[] {
  return [
    getIntroSection(options.outputStyle),
    getSystemRulesSection(),
    getDoingTasksSection(),
    getActionsSection(),
    getUsingToolsSection(options.toolNames),
    getToneStyleSection(),
    getOutputEfficiencySection(),
    getEnvironmentSection(options.env),
  ]
}
