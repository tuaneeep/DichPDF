export type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

export type JobStatusKind = 'queued' | 'running' | 'processing' | 'succeeded' | 'failed' | 'canceled' | string

export type JobProgressView = {
  current?: number | null
  total?: number | null
  percent?: number | null
}

export type JobListItemView = {
  id?: string
  job_id: string
  title?: string | null
  authors?: string | null
  display_name?: string
  workflow?: string
  status: JobStatusKind
  stage?: string | null
  stage_detail?: string | null
  message?: string | null
  progress?: number | JobProgressView | null
  page_count?: number | null
  source_file_name?: string | null
  cover_url?: string | null
  thumbnail_url?: string | null
  output_pdf_ready?: boolean
  markdown_ready?: boolean
  bundle_ready?: boolean
  created_at: string
  updated_at: string
  detail_path: string
  detail_url: string
}

export type JobListView = {
  items: JobListItemView[]
  invocation_summary?: unknown
}

export type JobBookSummaryView = {
  title?: string | null
  authors?: string | null
  page_count?: number | null
  source_language?: string | null
  target_language?: string | null
  source_file_name?: string | null
  cover_url?: string | null
  thumbnail_url?: string | null
  file_size_bytes?: number | null
}

export type JobArtifactDisplayView = {
  key: string
  label: string
  ready: boolean
  kind: string
  file_name?: string | null
  size_bytes?: number | null
  download_url?: string | null
}

export type JobDetailView = JobListItemView & {
  book_summary?: JobBookSummaryView | null
  artifacts_display?: JobArtifactDisplayView[] | null
  artifacts?: JobArtifactDisplayView[] | null
  source_language?: string | null
  target_language?: string | null
  file_size_bytes?: number | null
}

export type LibraryDeleteResultView = {
  deleted: boolean
  job_id: string
  removed_paths: string[]
  removed_child_jobs: string[]
}
