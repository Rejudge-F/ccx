import { promises as dns } from "node:dns"
import { isIP } from "node:net"

import type { OhMyCCAgentConfig } from "../config/schema"

const WEBFETCH_TOOL_NAMES = new Set([
  "webfetch",
  "web_fetch",
  "fetch",
  "http",
  "httprequest",
  "http_request",
  "url",
])

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
const DNS_TIMEOUT_MS = 2000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function extractUrls(args: unknown, acc: string[] = []): string[] {
  if (!args) return acc
  if (typeof args === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(args)) acc.push(args)
    return acc
  }
  if (Array.isArray(args)) {
    for (const item of args) extractUrls(item, acc)
    return acc
  }
  if (isRecord(args)) {
    for (const key of ["url", "uri", "href", "endpoint", "target"]) {
      const value = args[key]
      if (typeof value === "string") acc.push(value)
    }
    for (const key of Object.keys(args)) {
      if (["url", "uri", "href", "endpoint", "target"].includes(key)) continue
      extractUrls(args[key], acc)
    }
  }
  return acc
}

export function isBlockedAddress(address: string, allowLoopback: boolean): boolean {
  const version = isIP(address)
  if (version === 4) return isBlockedV4(address, allowLoopback)
  if (version === 6) return isBlockedV6(address, allowLoopback)
  return false
}

function isBlockedV4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false
  const [a, b] = parts as [number, number, number, number]

  if (a === 127) return !allowLoopback
  if (a === 0) return true
  if (a === 10) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 168) return true

  return false
}

function isBlockedV6(address: string, allowLoopback: boolean): boolean {
  const lower = address.toLowerCase()
  if (lower === "::1") return !allowLoopback
  if (lower === "::") return true
  const mapped = extractMappedIPv4(lower)
  if (mapped !== null) return isBlockedV4(mapped, allowLoopback)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  const firstHextet = lower.split(":")[0]
  if (firstHextet && firstHextet.length === 4 && firstHextet >= "fe80" && firstHextet <= "febf") {
    return true
  }
  return false
}

function expandIPv6Groups(addr: string): number[] | null {
  let tailHextets: number[] = []
  let working = addr
  if (working.includes(".")) {
    const lastColon = working.lastIndexOf(":")
    const v4 = working.slice(lastColon + 1)
    working = working.slice(0, lastColon)
    const octets = v4.split(".").map(Number)
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null
    }
    tailHextets = [
      (octets[0]! << 8) | octets[1]!,
      (octets[2]! << 8) | octets[3]!,
    ]
  }

  const dbl = working.indexOf("::")
  let head: string[]
  let tail: string[]
  if (dbl === -1) {
    head = working.split(":")
    tail = []
  } else {
    const headStr = working.slice(0, dbl)
    const tailStr = working.slice(dbl + 2)
    head = headStr === "" ? [] : headStr.split(":")
    tail = tailStr === "" ? [] : tailStr.split(":")
  }

  const target = 8 - tailHextets.length
  const fill = target - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array<string>(fill).fill("0"), ...tail]
  const nums = hex.map((h) => parseInt(h, 16))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  nums.push(...tailHextets)
  return nums.length === 8 ? nums : null
}

function extractMappedIPv4(addr: string): string | null {
  const g = expandIPv6Groups(addr)
  if (!g) return null
  if (
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff
  ) {
    const hi = g[6]!
    const lo = g[7]!
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return null
}

async function resolveWithTimeout(hostname: string): Promise<string[]> {
  const lookupPromise = dns.lookup(hostname, { all: true }).then((records) =>
    records.map((record) => record.address),
  )
  const timeoutPromise = new Promise<string[]>((_, reject) => {
    setTimeout(() => reject(new Error("dns-timeout")), DNS_TIMEOUT_MS)
  })
  return Promise.race([lookupPromise, timeoutPromise])
}

type UrlInspection = {
  url: string
  reason: string
  blocked: boolean
}

export type SsrfGuardOptions = {
  allowLoopback: boolean
  extraBlockedHosts: Set<string>
  extraAllowedHosts: Set<string>
}

export async function inspectUrl(url: string, options: SsrfGuardOptions): Promise<UrlInspection> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { url, reason: "invalid-url", blocked: true }
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      url,
      reason: `disallowed-protocol:${parsed.protocol.replace(":", "")}`,
      blocked: true,
    }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return { url, reason: "empty-host", blocked: true }

  // URL.hostname keeps IPv6 brackets (e.g. "[fc00::1]"). Strip them so that
  // isIP() recognises the literal and our blocklist can match.
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname

  if (options.extraAllowedHosts.has(bareHost)) {
    return { url, reason: "user-allowed", blocked: false }
  }
  if (options.extraBlockedHosts.has(bareHost)) {
    return { url, reason: "user-blocked", blocked: true }
  }
  if (bareHost === "localhost") {
    return {
      url,
      reason: "loopback:localhost",
      blocked: !options.allowLoopback,
    }
  }

  const ipVersion = isIP(bareHost)
  if (ipVersion !== 0) {
    const blocked = isBlockedAddress(bareHost, options.allowLoopback)
    return {
      url,
      reason: blocked ? `blocked-ip-literal:${bareHost}` : "public-ip-literal",
      blocked,
    }
  }

  try {
    const addresses = await resolveWithTimeout(bareHost)
    for (const address of addresses) {
      if (isBlockedAddress(address, options.allowLoopback)) {
        return {
          url,
          reason: `dns-resolves-private:${bareHost}->${address}`,
          blocked: true,
        }
      }
    }
    return { url, reason: "public-dns-resolution", blocked: false }
  } catch (error) {
    return {
      url,
      reason: `dns-error:${(error as Error).message ?? "unknown"}`,
      blocked: false,
    }
  }
}

export function createSsrfGuard(config: OhMyCCAgentConfig) {
  return async (input: unknown, output: unknown): Promise<void> => {
    if (!config.ssrf_guard.enabled) return
    if (!isRecord(input) || !isRecord(output)) return

    const toolName = typeof input.tool === "string" ? input.tool.toLowerCase() : ""
    if (!WEBFETCH_TOOL_NAMES.has(toolName)) return

    const urls = extractUrls(output.args)
    if (urls.length === 0) return

    const options: SsrfGuardOptions = {
      allowLoopback: config.ssrf_guard.allow_loopback,
      extraBlockedHosts: new Set(config.ssrf_guard.extra_blocked_hosts.map((h) => h.toLowerCase())),
      extraAllowedHosts: new Set(config.ssrf_guard.extra_allowed_hosts.map((h) => h.toLowerCase())),
    }

    const inspections = await Promise.all(urls.map((url) => inspectUrl(url, options)))
    const blocked = inspections.find((r) => r.blocked)
    if (!blocked) return

    output.blocked = true
    output.warning = `SSRF guard blocked network request: ${blocked.url} (${blocked.reason}). If this is a legitimate internal host, add it to ssrf_guard.extra_allowed_hosts in ccx.json.`
    const metadata = isRecord(output.metadata) ? output.metadata : {}
    metadata.ssrfGuard = {
      flagged: true,
      blocked: true,
      url: blocked.url,
      reason: blocked.reason,
      allInspections: inspections,
    }
    output.metadata = metadata
  }
}
