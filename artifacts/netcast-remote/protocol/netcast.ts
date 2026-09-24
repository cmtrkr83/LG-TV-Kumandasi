export const ROAP_PORT = 8080
export const ROAP_TIMEOUT_MS = 8000
export const DIRECT_SCAN_TIMEOUT_MS = 450
export const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>'

export type Connection = {
  host: string
  accessToken: string
  session?: string
  name?: string
}

export type NetcastErrorKind =
  | 'auth'
  | 'unsupported'
  | 'transient'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'protocol'
  | 'unknown'

export class NetcastRequestError extends Error {
  readonly kind: NetcastErrorKind
  readonly status?: number
  readonly body?: string

  constructor(message: string, kind: NetcastErrorKind, status?: number, body?: string) {
    super(message)
    this.name = 'NetcastRequestError'
    this.kind = kind
    this.status = status
    this.body = body
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function httpError(status: number, body: string) {
  if (status === 401 || status === 403) {
    return new NetcastRequestError('TV eşleştirme anahtarını kabul etmedi.', 'auth', status, body)
  }
  if (status === 400 || status === 404) {
    return new NetcastRequestError('TV istenen işlemi desteklemiyor.', 'unsupported', status, body)
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new NetcastRequestError('TV geçici olarak yanıt vermiyor.', 'transient', status, body)
  }
  return new NetcastRequestError(`TV yanıtı ${status}`, 'protocol', status, body)
}

export function isNetcastError(error: unknown): error is NetcastRequestError {
  return error instanceof NetcastRequestError
}

export function isAuthError(error: unknown) {
  return isNetcastError(error) && error.kind === 'auth'
}

export function isUnsupportedError(error: unknown) {
  return isNetcastError(error) && error.kind === 'unsupported'
}

export function isTransientError(error: unknown) {
  return isNetcastError(error) && (error.kind === 'transient' || error.kind === 'timeout' || error.kind === 'network')
}

export function isAbortErrorKind(error: unknown) {
  return isNetcastError(error) && error.kind === 'aborted'
}

function parseIpv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets
}

function isValidIpv6(value: string) {
  if (!value.includes(':') || value.includes('%') || value.includes('[') || value.includes(']')) return false
  try {
    return Boolean(new URL(`http://[${value}]/`).hostname)
  } catch {
    return false
  }
}

export function isValidTvHost(value: string) {
  const host = value.trim()
  if (!host || host.length > 253 || /[\s/?#]/.test(host) || host.includes('://')) return false
  const ipv4 = parseIpv4(host)
  if (ipv4) {
    if (ipv4.every((octet) => octet === 0) || ipv4.every((octet) => octet === 255)) return false
    if (ipv4[0] >= 224) return false
    return true
  }
  if (host.includes(':')) return isValidIpv6(host)
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)
}

export function normalizeHost(value: string) {
  const host = value.trim()
  return isValidTvHost(host) ? host : ''
}

export function tvUrl(host: string, path: string) {
  const safeHost = normalizeHost(host)
  if (!safeHost) throw new NetcastRequestError('Geçersiz TV adresi.', 'protocol')
  const formattedHost = safeHost.includes(':') ? `[${safeHost}]` : safeHost
  return `http://${formattedHost}:${ROAP_PORT}/roap/api/${path}`
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort()

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new NetcastRequestError('TV isteği zaman aşımına uğradı.', 'timeout'))
    }, timeoutMs)
  })

  try {
    let response: Response
    try {
      response = await Promise.race([
        fetch(url, { ...init, signal: controller.signal }),
        timeoutPromise,
      ])
    } catch (error) {
      if (timedOut) throw new NetcastRequestError('TV isteği zaman aşımına uğradı.', 'timeout')
      if (signal?.aborted || isAbortError(error)) {
        throw new NetcastRequestError('TV isteği iptal edildi.', 'aborted')
      }
      throw new NetcastRequestError('TV’ye ağ üzerinden ulaşılamadı.', 'network')
    }

    let text: string
    try {
      text = await Promise.race([
        response.text(),
        timeoutPromise,
      ])
    } catch (error) {
      if (timedOut) throw new NetcastRequestError('TV isteği zaman aşımına uğradı.', 'timeout')
      if (signal?.aborted || isAbortError(error)) {
        throw new NetcastRequestError('TV isteği iptal edildi.', 'aborted')
      }
      throw new NetcastRequestError('TV yanıtı okunamadı.', 'network')
    }

    if (!response.ok) throw httpError(response.status, text)
    return { response, text }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function postXml(
  url: string,
  body: string,
  signal?: AbortSignal,
  timeoutMs = ROAP_TIMEOUT_MS,
) {
  const { text } = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/atom+xml' },
      body,
    },
    timeoutMs,
    signal,
  )
  return text
}

export async function getXml(
  url: string,
  signal?: AbortSignal,
  timeoutMs = ROAP_TIMEOUT_MS,
) {
  const { text } = await fetchWithTimeout(
    url,
    {
      headers: { Accept: 'application/xml', 'User-Agent': 'UDAP/2.0' },
    },
    timeoutMs,
    signal,
  )
  return text
}

export function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? ''
}

export function extractNetCastName(xml: string) {
  const match = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i)
  return match?.[1]?.trim() || 'LG NetCast TV'
}

export async function requestPairingKey(host: string, signal?: AbortSignal) {
  return postXml(
    tvUrl(host, 'auth'),
    `${XML_HEADER}<auth><type>AuthKeyReq</type></auth>`,
    signal,
  )
}

export async function createSession(host: string, accessToken: string, signal?: AbortSignal) {
  let response: string
  try {
    response = await postXml(
      tvUrl(host, 'auth'),
      `${XML_HEADER}<auth><type>AuthReq</type><value>${escapeXml(accessToken)}</value></auth>`,
      signal,
    )
  } catch (error) {
    if (isNetcastError(error) && (error.status === 400 || error.status === 404)) {
      throw new NetcastRequestError('TV eşleştirme anahtarını kabul etmedi.', 'auth', error.status, error.body)
    }
    throw error
  }
  const session = xmlValue(response, 'session')
  if (!session) {
    throw new NetcastRequestError('TV eşleştirme anahtarını kabul etmedi.', 'auth', undefined, response)
  }
  return session
}

export async function sendCommand(connection: Connection, key: number, signal?: AbortSignal) {
  if (!connection.session) throw new NetcastRequestError('TV bağlantısı hazır değil.', 'protocol')
  await postXml(
    tvUrl(connection.host, 'command'),
    `${XML_HEADER}<command><session>${escapeXml(connection.session)}</session><type>HandleKeyInput</type><value>${key}</value></command>`,
    signal,
  )
}

export async function sendRawCommand(connection: Connection, innerXml: string, signal?: AbortSignal) {
  if (!connection.session) throw new NetcastRequestError('TV bağlantısı hazır değil.', 'protocol')
  await postXml(
    tvUrl(connection.host, 'command'),
    `${XML_HEADER}<command><session>${escapeXml(connection.session)}</session>${innerXml}</command>`,
    signal,
  )
}

export async function sendTouchMove(connection: Connection, dx: number, dy: number, signal?: AbortSignal) {
  await sendRawCommand(
    connection,
    `<type>HandleTouchMove</type><x>${Math.round(dx)}</x><y>${Math.round(dy)}</y>`,
    signal,
  )
}

export async function sendTouchClick(connection: Connection, signal?: AbortSignal) {
  await sendRawCommand(connection, '<type>HandleTouchClick</type>', signal)
}

export async function sendTouchWheel(connection: Connection, direction: 'up' | 'down', signal?: AbortSignal) {
  await sendRawCommand(connection, `<type>HandleTouchWheel</type><value>${direction}</value>`, signal)
}

export async function probeNetCastHost(host: string, signal?: AbortSignal) {
  try {
    const body = await getXml(
      tvUrl(host, 'data?target=rootservice.xml'),
      signal,
      DIRECT_SCAN_TIMEOUT_MS,
    )
    if (!body.includes('<') || !/friendlyName|rootservice|udap/i.test(body)) return null
    const name = extractNetCastName(body)
    return {
      id: `netcast:${host}`,
      host,
      name,
      online: true,
      model: name,
      server: 'UDAP/NetCast',
    }
  } catch {
    return null
  }
}
