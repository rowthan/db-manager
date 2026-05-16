const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const AUTH_COOKIE_NAME = 'db-manager-session'
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export type AuthConfig = {
  password: string
  sessionSecret: string
  sessionTtlSeconds: number
}

type SessionPayload = {
  exp: number
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  const binary = atob(base64 + padding)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function signMessage(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message))
  return toBase64Url(new Uint8Array(signature))
}

function parseSessionPayload(encodedPayload: string): SessionPayload | null {
  try {
    const json = textDecoder.decode(fromBase64Url(encodedPayload))
    const payload = JSON.parse(json) as SessionPayload

    if (!payload || typeof payload.exp !== 'number') {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export function getAuthConfig(): AuthConfig | null {
  const password = process.env.DB_MANAGER_PASSWORD?.trim() || ''
  const sessionSecret = process.env.DB_MANAGER_SESSION_SECRET?.trim() || ''
  const sessionTtlSecondsRaw = Number(process.env.DB_MANAGER_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS)
  const sessionTtlSeconds =
    Number.isFinite(sessionTtlSecondsRaw) && sessionTtlSecondsRaw > 0
      ? sessionTtlSecondsRaw
      : DEFAULT_SESSION_TTL_SECONDS

  if (!password || !sessionSecret) {
    return null
  }

  return {
    password,
    sessionSecret,
    sessionTtlSeconds,
  }
}

export function isAuthConfigured() {
  return getAuthConfig() !== null
}

export function sanitizeNextPath(input?: string | null) {
  if (!input) {
    return '/db'
  }

  const trimmed = input.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/db'
  }

  return trimmed
}

export async function createSessionToken(config: AuthConfig) {
  const payload: SessionPayload = {
    exp: Date.now() + config.sessionTtlSeconds * 1000,
  }

  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)))
  const signature = await signMessage(config.sessionSecret, encodedPayload)

  return `${encodedPayload}.${signature}`
}

export async function verifySessionToken(token: string | undefined, sessionSecret: string) {
  if (!token) {
    return false
  }

  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) {
    return false
  }

  const expectedSignature = await signMessage(sessionSecret, encodedPayload)
  if (expectedSignature !== signature) {
    return false
  }

  const payload = parseSessionPayload(encodedPayload)
  if (!payload) {
    return false
  }

  return Date.now() < payload.exp
}
