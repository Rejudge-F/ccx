import { existsSync } from "fs"
import { join } from "path"
import { type as osType, release as osRelease } from "os"

export type EnvironmentInfo = {
  cwd: string
  isGit: boolean
  platform: string
  shell: string
}

function normalizeShell(shell: string): string {
  if (shell.includes('zsh')) return 'zsh'
  if (shell.includes('bash')) return 'bash'
  return shell || 'unknown'
}

function getDateString(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
}

function getOsVersion(): string {
  try {
    return `${osType()} ${osRelease()}`
  } catch {
    return "unknown"
  }
}

export function detectGit(cwd: string): boolean {
  try {
    return existsSync(join(cwd, ".git"))
  } catch {
    return false
  }
}

export function getEnvironmentSection(env: EnvironmentInfo): string {
  const shellName = normalizeShell(env.shell)
  const shellLine =
    env.platform === 'win32'
      ? `Shell: ${shellName} (use Unix shell syntax, not Windows-specific syntax)`
      : `Shell: ${shellName}`

  return `# Environment
Here is useful information about the environment you are running in:
<env>
  Working directory: ${env.cwd}
  Is directory a git repo: ${env.isGit ? "yes" : "no"}
  Platform: ${env.platform}
  ${shellLine}
  OS Version: ${getOsVersion()}
  Today's date: ${getDateString()}
</env>`
}
