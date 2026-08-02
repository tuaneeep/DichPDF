import type { ApiResponse, JobDetailView, JobListView, LibraryDeleteResultView } from './library-api-types'

type RuntimeConfig = {
  apiBase?: string
  xApiKey?: string
}

declare global {
  interface Window {
    __FRONT_RUNTIME_CONFIG__?: RuntimeConfig
  }
}

const API_V1_SUFFIX = '/api/v1'

function runtimeConfig() {
  return window.__FRONT_RUNTIME_CONFIG__ ?? {}
}

export function libraryApiBase() {
  const envBase = import.meta.env.VITE_RETAIN_API_BASE_URL as string | undefined
  const configured = envBase?.trim() || runtimeConfig().apiBase?.trim()

  if (configured) {
    return configured.replace(/\/+$/, '').replace(new RegExp(`${API_V1_SUFFIX}$`), '')
  }

  return ''
}

function libraryApiKey() {
  const envKey = import.meta.env.VITE_RETAIN_API_KEY as string | undefined
  return envKey?.trim() || runtimeConfig().xApiKey?.trim() || ''
}

function buildApiUrl(path: string) {
  return `${libraryApiBase()}${API_V1_SUFFIX}/${path.replace(/^\/+/, '')}`
}

export function libraryApiUrl(path: string) {
  return buildApiUrl(path)
}

export function libraryResourceUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const url = new URL(pathOrUrl)

    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.startsWith(API_V1_SUFFIX)) {
      return `${url.pathname}${url.search}`
    }

    return pathOrUrl
  }

  const path = pathOrUrl.replace(/^\/+/, '')

  if (path.startsWith('api/v1/')) {
    return `${libraryApiBase()}/${path}`
  }

  return buildApiUrl(path)
}

function buildHeaders() {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = libraryApiKey()

  if (apiKey) {
    headers['X-API-Key'] = apiKey
  }

  return headers
}

export function libraryRequestHeaders() {
  return buildHeaders()
}

type LibraryApiOptions = {
  baseUrl?: string
  apiKey?: string
}

function buildLibraryRequestHeaders(options: LibraryApiOptions = {}) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = options.apiKey?.trim() || libraryApiKey()

  if (apiKey) {
    headers['X-API-Key'] = apiKey
  }

  return headers
}

function buildLibraryApiUrl(path: string, options: LibraryApiOptions = {}) {
  const base = options.baseUrl?.trim() || libraryApiBase()
  const normalizedBase = base.replace(/\/+$/, '')
  return `${normalizedBase}${API_V1_SUFFIX}/${path.replace(/^\/+/, '')}`
}

function fileNameFromDisposition(disposition: string | null) {
  const utf8Match = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const asciiMatch = disposition?.match(/filename="?([^";]+)"?/i)
  return asciiMatch?.[1]
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), { headers: buildHeaders() })

  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`)
  }

  const payload = (await response.json()) as ApiResponse<T>

  if (payload.code !== 0) {
    throw new Error(payload.message || `GET ${path} failed`)
  }

  return payload.data
}

export function listLibraryJobs(limit = 100) {
  return getJson<JobListView>(`library/books?limit=${limit}`)
}

export function getLibraryJob(jobId: string) {
  return getJson<JobDetailView>(`library/books/${encodeURIComponent(jobId)}`)
}

function libraryBookId(jobId: string) {
  return jobId.endsWith('-ocr') ? jobId.slice(0, -4) : jobId
}

export async function uploadLibraryPdf(file: File, options: LibraryApiOptions = {}) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('developer_mode', 'false')

  const response = await fetch(buildLibraryApiUrl('uploads', options), {
    method: 'POST',
    headers: buildLibraryRequestHeaders(options),
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`)
  }

  const payload = (await response.json()) as ApiResponse<{ upload_id: string; filename: string; bytes: number; page_count: number; uploaded_at: string }>
  if (payload.code !== 0) {
    throw new Error(payload.message || 'upload failed')
  }

  return payload.data
}

export async function createLibraryJob(payload: object, options: LibraryApiOptions = {}) {
  const response = await fetch(buildLibraryApiUrl('jobs', options), {
    method: 'POST',
    headers: {
      ...buildLibraryRequestHeaders(options),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`create job failed: ${response.status}`)
  }

  const result = (await response.json()) as ApiResponse<{ job_id: string; status: string }>
  if (result.code !== 0) {
    throw new Error(result.message || 'create job failed')
  }

  return result.data
}

export async function getLibraryJobDetail(jobId: string, options: LibraryApiOptions = {}) {
  const response = await fetch(buildLibraryApiUrl(`jobs/${encodeURIComponent(jobId)}`, options), {
    headers: buildLibraryRequestHeaders(options),
  })

  if (!response.ok) {
    throw new Error(`get job failed: ${response.status}`)
  }

  const payload = (await response.json()) as ApiResponse<JobDetailView>
  if (payload.code !== 0) {
    throw new Error(payload.message || 'get job failed')
  }

  return payload.data
}

export async function deleteLibraryBook(jobId: string, options: { force?: boolean } = {}) {
  const bookId = libraryBookId(jobId)
  const search = options.force ? '?force=true' : ''
  const response = await fetch(buildApiUrl(`library/books/${encodeURIComponent(bookId)}${search}`), {
    method: 'DELETE',
    headers: buildHeaders(),
  })

  if (!response.ok) {
    throw new Error(`DELETE library/books/${bookId} failed: ${response.status}`)
  }

  const payload = (await response.json()) as ApiResponse<LibraryDeleteResultView>

  if (payload.code !== 0) {
    throw new Error(payload.message || `DELETE library/books/${bookId} failed`)
  }

  return payload.data
}

export async function downloadLibraryResource(pathOrUrl: string, fallbackFileName: string) {
  const response = await fetch(libraryResourceUrl(pathOrUrl), { headers: buildHeaders() })

  if (!response.ok) {
    throw new Error(`download failed: ${response.status}`)
  }

  const blob = await response.blob()
  const fileName = fileNameFromDisposition(response.headers.get('content-disposition')) || fallbackFileName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener noreferrer'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
