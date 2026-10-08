/**
 * AWS Signature Version 4。只在发送时计算，签名不写入集合。
 */

export interface AwsSigInput {
  method: string
  url: string
  headers: Map<string, string>
  body: string
  accessKey: string
  secretKey: string
  region: string
  service: string
  sessionToken?: string
  now?: Date
}

/** 写入 Authorization、x-amz-date，以及可选的 session token。 */
export async function applyAwsSigV4(input: AwsSigInput): Promise<void> {
  const target = new URL(input.url)
  const now = input.now ?? new Date()
  const amzDate = stamp(now)
  const date = amzDate.slice(0, 8)
  const headers = new Map<string, string>()
  for (const [key, value] of input.headers) {
    headers.set(key.toLowerCase(), value.trim().replace(/\s+/g, ' '))
  }
  headers.set('host', target.host)
  headers.set('x-amz-date', amzDate)
  const token = input.sessionToken?.trim()
  if (token) headers.set('x-amz-security-token', token)
  const payloadHash = await sha256Hex(input.body)
  const names = [...headers.keys()].sort()
  const canonicalHeaders = names.map((name) => `${name}:${headers.get(name)}\n`).join('')
  const signedHeaders = names.join(';')
  const canonical = [
    input.method.toUpperCase(),
    canonicalPath(target),
    canonicalQuery(target),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n')
  const signingKey = await deriveKey(input.secretKey, date, input.region, input.service)
  const signature = bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, textBytes(stringToSign))))
  input.headers.set('host', target.host)
  input.headers.set('x-amz-date', amzDate)
  if (token) input.headers.set('x-amz-security-token', token)
  input.headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  )
}

function canonicalPath(target: URL): string {
  return target.pathname || '/'
}

function canonicalQuery(target: URL): string {
  const pairs: string[] = []
  target.searchParams.forEach((value, key) => {
    pairs.push(`${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
  })
  return pairs.sort().join('&')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function deriveKey(secret: string, date: string, region: string, service: string): Promise<CryptoKey> {
  let key = await hmacKey(textBytes(`AWS4${secret}`))
  key = await hmacRaw(key, date)
  key = await hmacRaw(key, region)
  key = await hmacRaw(key, service)
  return hmacRaw(key, 'aws4_request')
}

async function hmacKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function hmacRaw(key: CryptoKey, text: string): Promise<CryptoKey> {
  const signed = await crypto.subtle.sign('HMAC', key, textBytes(text))
  return hmacKey(signed)
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textBytes(text))
  return bytesToHex(new Uint8Array(digest))
}

function textBytes(text: string): BufferSource {
  return new TextEncoder().encode(text) as BufferSource
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}
