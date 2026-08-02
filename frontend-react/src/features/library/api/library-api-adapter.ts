import type { StageKey, StatusSnapshot } from '@/features/status'

import type { LibraryBook, LibraryBookArtifact, LibraryBookStatus } from '../types'
import { libraryResourceUrl } from './library-api-client'
import type { JobArtifactDisplayView, JobDetailView, JobListItemView } from './library-api-types'

const stageMap: Record<string, StageKey> = {
  ocr: 'ocr',
  ocr_upload: 'ocr',
  ocr_processing: 'ocr',
  normalizing: 'ocr',
  translate: 'translate',
  translating: 'translate',
  translation_batches: 'translate',
  continuation_review: 'translate',
  page_policies: 'translate',
  render: 'render',
  rendering: 'render',
  saving: 'render',
  done: 'done',
  finished: 'done',
}

export function jobListToLibraryBooks(items: JobListItemView[]): LibraryBook[] {
  return items
    .filter((item) => !item.job_id.endsWith('-ocr'))
    .map(jobListItemToLibraryBook)
}

export function jobDetailToLibraryBook(detail: JobDetailView, previous?: LibraryBook): LibraryBook {
  const base = jobListItemToLibraryBook(detail)
  const summary = detail.book_summary
  const title = summary?.title?.trim() || base.title
  const authors = summary?.authors?.trim() || previous?.authors || base.authors
  const pages = summary?.page_count ?? base.pages
  const detailArtifacts = detail.artifacts_display ?? detail.artifacts

  return {
    ...base,
    title,
    authors,
    pages,
    coverTone: previous?.coverTone ?? base.coverTone,
    coverUrl: normalizeOptionalResourceUrl(summary?.cover_url || detail.cover_url) || base.coverUrl || previous?.coverUrl,
    thumbnailUrl: normalizeOptionalResourceUrl(summary?.thumbnail_url || detail.thumbnail_url) || base.thumbnailUrl || previous?.thumbnailUrl,
    detail: {
      ...base.detail,
      sourceLanguage: summary?.source_language?.trim() || detail.source_language?.trim() || base.detail?.sourceLanguage || '',
      targetLanguage: summary?.target_language?.trim() || detail.target_language?.trim() || base.detail?.targetLanguage || '',
      workflow: detail.workflow || base.detail?.workflow || '',
      ocrProvider: previous?.detail?.ocrProvider ?? '',
      translationEngine: previous?.detail?.translationEngine ?? '',
      fileSize: formatBytes(summary?.file_size_bytes ?? detail.file_size_bytes) || base.detail?.fileSize || '',
      createdAt: base.detail?.createdAt || '',
      description: detail.stage_detail || previous?.detail?.description || base.detail?.description || '',
      tags: buildDetailTags(detail, previous),
      artifacts: buildDetailArtifacts(detailArtifacts, detail),
    },
  }
}

function jobListItemToLibraryBook(item: JobListItemView): LibraryBook {
  const pages = item.page_count ?? 0
  const status = mapJobStatus(item.status)
  const stage = mapStage(item.stage, status)
  const progressText = progressLabel(item)

  return {
    id: item.job_id,
    title: item.title || item.display_name || item.source_file_name || item.job_id,
    authors: item.authors || item.workflow || '',
    pages,
    status,
    updatedAt: formatUpdatedAt(item.updated_at),
    progressLabel: progressText,
    coverTone: coverToneForJob(item.job_id),
    coverUrl: normalizeOptionalResourceUrl(item.cover_url),
    thumbnailUrl: normalizeOptionalResourceUrl(item.thumbnail_url),
    detail: {
      sourceLanguage: '',
      targetLanguage: '',
      workflow: item.workflow || '',
      ocrProvider: '',
      translationEngine: '',
      fileSize: '',
      createdAt: formatUpdatedAt(item.created_at),
      description: item.stage_detail || progressText,
      tags: [item.workflow, item.status].filter((tag): tag is string => Boolean(tag)),
      artifacts: buildListArtifacts(item),
    },
    snapshot: buildListSnapshot(item, stage),
  }
}

function normalizeOptionalResourceUrl(value?: string | null) {
  return value?.trim() ? libraryResourceUrl(value) : undefined
}

function mapJobStatus(status: string): LibraryBookStatus {
  if (status === 'succeeded') {
    return 'ready'
  }
  if (status === 'queued') {
    return 'queued'
  }
  return 'processing'
}

function mapStage(stage: string | null | undefined, status: LibraryBookStatus): StageKey {
  if (status === 'ready') {
    return 'done'
  }
  if (status === 'queued') {
    return 'ocr'
  }
  const normalized = `${stage ?? ''}`.trim()
  return stageMap[normalized] ?? 'translate'
}

function buildListSnapshot(item: JobListItemView, activeStage: StageKey): StatusSnapshot {
  const progObj = typeof item.progress === 'object' && item.progress !== null ? item.progress : null
  const current = progObj?.current ?? (typeof item.progress === 'number' ? item.progress : undefined)
  const total = progObj?.total ?? (typeof item.progress === 'number' ? 100 : undefined)

  return {
    activeStage,
    selectedStage: activeStage,
    elapsedText: item.status === 'succeeded' ? '完成' : item.status === 'queued' ? '排队中' : '处理中',
    pdfReady: item.output_pdf_ready,
    readerReady: item.markdown_ready,
    stageProgress: {
      [activeStage]: {
        current,
        total,
        text: progressLabel(item),
        indeterminate: !total,
      },
    },
  }
}

function progressLabel(item: JobListItemView) {
  if (item.stage_detail?.trim()) {
    return item.stage_detail
  }
  const progObj = typeof item.progress === 'object' && item.progress !== null ? item.progress : null
  if (progObj?.current != null && progObj?.total != null) {
    return `${progObj.current}/${progObj.total}`
  }
  if (typeof item.progress === 'number') {
    return `${item.progress}%`
  }
  return item.status === 'queued' ? '等待开始' : item.status === 'succeeded' ? '已完成' : '处理中'
}

function buildListArtifacts(item: JobListItemView): LibraryBookArtifact[] {
  return [
    { key: 'pdf', label: '译文 PDF', state: item.output_pdf_ready ? 'ready' : 'processing', detail: item.output_pdf_ready ? '可下载' : '等待生成' },
    { key: 'markdown', label: 'Markdown', state: item.markdown_ready ? 'ready' : 'processing', detail: item.markdown_ready ? '可查看' : '等待生成' },
    { key: 'bundle', label: '任务包', state: item.bundle_ready ? 'ready' : 'processing', detail: item.bundle_ready ? '可下载' : '等待生成' },
  ]
}

function buildDetailArtifacts(artifacts: JobArtifactDisplayView[] | null | undefined, fallback: JobListItemView): LibraryBookArtifact[] {
  if (!artifacts?.length) {
    return buildListArtifacts(fallback)
  }

  return artifacts.map((artifact) => ({
    key: artifact.key,
    label: artifact.label,
    state: artifact.ready ? 'ready' : 'processing',
    detail: artifact.file_name || formatBytes(artifact.size_bytes) || artifact.kind,
    kind: artifact.kind,
    fileName: artifact.file_name ?? undefined,
    sizeBytes: artifact.size_bytes ?? undefined,
    downloadUrl: artifact.download_url ?? undefined,
  }))
}

function buildDetailTags(detail: JobDetailView, previous?: LibraryBook) {
  return [
    detail.workflow,
    detail.status,
    detail.book_summary?.source_language,
    detail.book_summary?.target_language,
    ...(previous?.detail?.tags ?? []),
  ].filter((tag, index, tags): tag is string => Boolean(tag?.trim()) && tags.indexOf(tag) === index)
}

function formatBytes(value?: number | null) {
  if (!Number.isFinite(value) || !value) {
    return ''
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const fixed = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)
  return `${fixed} ${units[unitIndex]}`
}

function coverToneForJob(jobId: string): LibraryBook['coverTone'] {
  const hash = Array.from(jobId).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return hash % 3 === 0 ? 'dark' : hash % 3 === 1 ? 'medium' : 'light'
}

function formatUpdatedAt(value: string) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
