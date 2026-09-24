import { probeNetCastHost } from './netcast'

const MAX_SCAN_HOSTS = 32

function octets(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const result = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  if (result.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return result
}

export function getSafeScanHosts(localIp: string, maxHosts = MAX_SCAN_HOSTS) {
  const parsed = octets(localIp)
  if (!parsed || parsed.every((part) => part === 0)) return []
  const isPrivate = parsed[0] === 10 ||
    (parsed[0] === 172 && parsed[1] >= 16 && parsed[1] <= 31) ||
    (parsed[0] === 192 && parsed[1] === 168) ||
    (parsed[0] === 169 && parsed[1] === 254)
  if (!isPrivate) return []
  const prefix = parsed.slice(0, 3).join('.')
  const ownHost = parsed[3]
  const limit = Math.max(1, Math.min(maxHosts, 254))
  let start = Math.max(1, ownHost - Math.floor(limit / 2))
  const end = Math.min(254, start + limit - 1)
  if (end - start + 1 < limit) start = Math.max(1, end - limit + 1)

  const hosts: string[] = []
  for (let host = start; host <= end; host += 1) {
    if (host === ownHost) continue
    hosts.push(`${prefix}.${host}`)
  }
  return hosts
}

type ScannedTv = NonNullable<Awaited<ReturnType<typeof probeNetCastHost>>>

export async function scanLocalSubnet(
  localIp: string,
  onFound: (tv: ScannedTv) => void,
  signal?: AbortSignal,
) {
  const hosts = getSafeScanHosts(localIp)
  const batchSize = 16
  for (let index = 0; index < hosts.length; index += batchSize) {
    if (signal?.aborted) return
    const batch = hosts.slice(index, index + batchSize)
    const results = await Promise.all(batch.map((host) => probeNetCastHost(host, signal)))
    if (signal?.aborted) return
    for (const tv of results) {
      if (tv) onFound(tv)
    }
  }
}
