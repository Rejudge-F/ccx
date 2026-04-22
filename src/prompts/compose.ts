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
import { createPromptSection, resolvePromptSections } from './section-registry.js'
import type { OhMyCCAgentConfig } from '../config/schema.js'

const DISABLED_SECTION_ALIASES: Record<string, string> = {
  'system-rules': 'system',
  doing_tasks: 'doing-tasks',
  using_tools: 'using-tools',
  tone_style: 'tone-style',
  output_efficiency: 'output-efficiency',
}

function normalizeDisabledSectionIDs(ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return []
  return ids.map(id => DISABLED_SECTION_ALIASES[id] ?? id)
}

export type { EnvInfo, ToolNames }

export async function composeSystemPrompt(options: {
  toolNames: ToolNames
  env: EnvInfo
  outputStyle?: string
  disabledSectionIDs?: string[]
  toneStyle?: OhMyCCAgentConfig['tone_style']
  outputEfficiency?: OhMyCCAgentConfig['output_efficiency']
}): Promise<string[]> {
  const sections = [
    createPromptSection({
      id: 'intro',
      kind: 'static',
      resolve: () => getIntroSection(options.outputStyle),
    }),
    createPromptSection({
      id: 'system',
      kind: 'static',
      resolve: () => getSystemRulesSection(),
    }),
    createPromptSection({
      id: 'doing-tasks',
      kind: 'static',
      resolve: () => getDoingTasksSection(),
    }),
    createPromptSection({
      id: 'actions',
      kind: 'static',
      resolve: () => getActionsSection(),
    }),
    createPromptSection({
      id: 'using-tools',
      kind: 'static',
      resolve: () => getUsingToolsSection(options.toolNames),
    }),
    createPromptSection({
      id: 'tone-style',
      kind: 'static',
      resolve: () => getToneStyleSection(options.toneStyle),
    }),
    createPromptSection({
      id: 'output-efficiency',
      kind: 'static',
      resolve: () => getOutputEfficiencySection(options.outputEfficiency),
    }),
    createPromptSection({
      id: 'environment',
      kind: 'static',
      resolve: () => getEnvironmentSection(options.env),
    }),
  ]

  return resolvePromptSections({
    sections,
    kind: 'static',
    disabledSectionIDs: normalizeDisabledSectionIDs(options.disabledSectionIDs),
  })
}
