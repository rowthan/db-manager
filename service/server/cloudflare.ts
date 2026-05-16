type CloudflareApiErrorItem = {
  code?: number
  message?: string
  documentation_url?: string
  source?: {
    pointer?: string
  }
}

type CloudflareApiEnvelope<T> = {
  success?: boolean
  errors?: CloudflareApiErrorItem[]
  messages?: string[]
  result?: T
}

type CloudflareR2ManagedDomainResult = {
  bucketId: string
  domain: string
  enabled: boolean
}

type CloudflarePublishInput = {
  accountId?: string
  bucketName?: string
  apiToken?: string
  objectKey: string
  content: string
  enablePublicAccess?: boolean
  publicBaseUrl?: string
}

export type CloudflarePublishOutput = {
  ok: true
  url: string
  objectKey: string
  bucketName: string
  domain: string
  enabled: boolean
  sizeBytes: number
}

function stringifyCloudflareErrors(errors?: CloudflareApiErrorItem[], fallback = 'Cloudflare API 请求失败') {
  if (!errors?.length) {
    return fallback
  }

  const parts = errors
    .map((error) => error.message?.trim())
    .filter((value): value is string => Boolean(value))

  return parts.length ? parts.join('；') : fallback
}

async function cloudflareApiRequest<T>(
  path: string,
  {
    apiToken,
    method = 'GET',
    body,
  }: {
    apiToken: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    body?: unknown
  }
) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const payload = (await response.json().catch(() => ({}))) as CloudflareApiEnvelope<T>

  if (!response.ok || payload.success === false) {
    throw new Error(stringifyCloudflareErrors(payload.errors, 'Cloudflare API 请求失败'))
  }

  if (!payload.result) {
    throw new Error('Cloudflare API 返回了空结果')
  }

  return payload.result
}

function encodeObjectKeyPath(objectKey: string) {
  return objectKey
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function buildPublicUrl(baseUrl: string, objectKey: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return `${normalizedBaseUrl}/${encodeObjectKeyPath(objectKey)}`
}

function readCloudflarePublishEnv() {
  return {
    accountId:
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.CLOUDFLARE_R2_ACCOUNT_ID ||
      '',
    bucketName:
      process.env.CLOUDFLARE_R2_BUCKET ||
      process.env.CLOUDFLARE_BUCKET_NAME ||
      '',
    apiToken:
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_R2_API_TOKEN ||
      '',
    publicBaseUrl:
      process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ||
      process.env.CLOUDFLARE_PUBLIC_BASE_URL ||
      '',
  }
}

export async function publishJsonToCloudflareR2({
  accountId,
  bucketName,
  apiToken,
  objectKey,
  content,
  enablePublicAccess = true,
  publicBaseUrl,
}: CloudflarePublishInput): Promise<CloudflarePublishOutput> {
  const envConfig = readCloudflarePublishEnv()
  const normalizedAccountId = (accountId || envConfig.accountId).trim()
  const normalizedBucketName = (bucketName || envConfig.bucketName).trim()
  const normalizedToken = (apiToken || envConfig.apiToken).trim()
  const normalizedObjectKey = objectKey.trim().replace(/^\/+/, '')

  if (!normalizedAccountId) {
    throw new Error('请填写 Cloudflare Account ID')
  }

  if (!normalizedBucketName) {
    throw new Error('请填写 Cloudflare R2 Bucket 名称')
  }

  if (!normalizedToken) {
    throw new Error('请填写 Cloudflare API Token')
  }

  if (!normalizedObjectKey) {
    throw new Error('请填写发布对象名称')
  }

  const sizeBytes = Buffer.byteLength(content, 'utf8')

  let baseUrl = (publicBaseUrl || envConfig.publicBaseUrl).trim().replace(/\/+$/, '')
  let domain = ''
  let enabled = false

  if (!baseUrl && enablePublicAccess) {
    const managed = await cloudflareApiRequest<CloudflareR2ManagedDomainResult>(
      `/accounts/${encodeURIComponent(normalizedAccountId)}/r2/buckets/${encodeURIComponent(normalizedBucketName)}/domains/managed`,
      {
        apiToken: normalizedToken,
        method: 'PUT',
        body: {
          enabled: true,
        },
      }
    )
    domain = managed.domain
    enabled = managed.enabled
    baseUrl = `https://${managed.domain}`
  } else if (baseUrl) {
    domain = new URL(baseUrl.startsWith('http://') || baseUrl.startsWith('https://') ? baseUrl : `https://${baseUrl}`).host
    enabled = true
  } else {
    throw new Error('请提供公开访问基址，或启用自动公开访问')
  }

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(normalizedAccountId)}/r2/buckets/${encodeURIComponent(normalizedBucketName)}/objects/${encodeObjectKeyPath(normalizedObjectKey)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        'Content-Type': 'application/json;charset=utf-8',
      },
      body: content,
    }
  ).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as CloudflareApiEnvelope<unknown>
    if (!response.ok || payload.success === false) {
      throw new Error(stringifyCloudflareErrors(payload.errors, '上传到 Cloudflare R2 失败'))
    }
  })

  const url = buildPublicUrl(baseUrl, normalizedObjectKey)

  return {
    ok: true,
    url,
    objectKey: normalizedObjectKey,
    bucketName: normalizedBucketName,
    domain,
    enabled,
    sizeBytes,
  }
}
