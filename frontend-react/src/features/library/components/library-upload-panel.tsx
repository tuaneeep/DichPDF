import { useState } from 'react'
import type { FormEvent, DragEvent } from 'react'
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  Settings,
  Globe,
  Sparkles,
  Key,
  ShieldCheck
} from 'lucide-react'

import { uploadLibraryPdf, createLibraryJob, getLibraryJobDetail } from '../api/library-api-client'
import type { JobDetailView } from '../api/library-api-types'

const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  { code: 'en', label: 'Tiếng Anh (English)' },
  { code: 'zh', label: 'Tiếng Trung (Chinese)' },
  { code: 'ja', label: 'Tiếng Nhật (Japanese)' },
  { code: 'fr', label: 'Tiếng Pháp (French)' },
  { code: 'de', label: 'Tiếng Đức (German)' },
  { code: 'es', label: 'Tiếng Tây Ban Nha (Spanish)' },
]

const PROVIDERS = [
  { code: 'google_translate', label: 'Google Translate (miễn phí)' },
  { code: 'groq', label: 'Groq (free tier)' },
  { code: 'gemini', label: 'Google Gemini AI' },
  { code: 'mock', label: 'Mock (local preview)' },
]

export function LibraryUploadPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [targetLang, setTargetLang] = useState('vi')
  const [provider, setProvider] = useState('google_translate')
  
  // Credentials should be supplied by the user or backend environment variables.
  const [geminiKey, setGeminiKey] = useState('')
  const [mineruAk, setMineruAk] = useState('')
  const [mineruSk, setMineruSk] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  
  // Processing state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [translatedPdfUrl, setTranslatedPdfUrl] = useState<string | null>(null)

  // API validation test state
  const [testingKeys, setTestingKeys] = useState(false)
  const [keyTestStatus, setKeyTestStatus] = useState<string | null>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.type === 'application/pdf' || droppedFile.name.endsWith('.pdf')) {
        setFile(droppedFile)
        setErrorMessage('')
      } else {
        setErrorMessage('Chỉ chấp nhận định dạng file PDF (.pdf).')
      }
    }
  }

  async function testApiKeys() {
    setTestingKeys(true)
    setKeyTestStatus(null)
    try {
      const res = await fetch('/api/v1/settings/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gemini_api_key: geminiKey,
          mineru_ak: mineruAk,
          mineru_sk: mineruSk,
        }),
      })
      const data = await res.json()
      if (data.code === 0) {
        const gm = data.data.gemini
        const mn = data.data.mineru
        if (gm.status === 'ok' && mn.status === 'ok') {
          setKeyTestStatus('✅ Cả Gemini API Key và MinerU AK/SK đều hợp lệ!')
        } else {
          let msg = ''
          if (gm.status !== 'ok') {
            msg += `⚠️ Gemini: ${gm.message} `
          }
          if (mn.status !== 'ok') {
            msg += `❌ MinerU: ${mn.message}.`
          }
          setKeyTestStatus(msg || 'Kết nối hoàn thành.')
        }
      }
    } catch (err) {
      setKeyTestStatus('Không thể kết nối tới server kiểm tra.')
    } finally {
      setTestingKeys(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!file) {
      setErrorMessage('Vui lòng chọn file PDF trước khi bấm dịch.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')
    setProgress(5)
    setStatusMessage('Đang chuẩn bị và tải file PDF lên server...')
    setTranslatedPdfUrl(null)

    try {
      // 1. Upload File
      const upload = await uploadLibraryPdf(file)
      setProgress(20)
      setStatusMessage(`Đã nhận file ${upload.filename} (${Math.round(upload.bytes / 1024)} KB, ${upload.page_count} trang). Đang khởi tạo tiến trình...`)

      // 2. Create Job
      const payload = {
        workflow: 'book',
        source: { upload_id: upload.upload_id },
        target_lang: targetLang,
        provider,
        gemini_api_key: geminiKey,
        mineru_ak: mineruAk,
        mineru_sk: mineruSk,
      }

      const job = await createLibraryJob(payload)
      setProgress(30)
      setStatusMessage(`Bắt đầu phân tích bố cục PDF với MinerU OCR & dịch văn bản với ${PROVIDERS.find((item) => item.code === provider)?.label ?? provider}...`)

      // 3. Poll Job Status
      let detail: JobDetailView | null = null
      for (let attempt = 0; attempt < 180; attempt += 1) {
        detail = await getLibraryJobDetail(job.job_id)

        if (typeof detail.progress === 'number') {
          setProgress(detail.progress)
        } else if (detail.progress && typeof detail.progress.percent === 'number') {
          setProgress(detail.progress.percent)
        }

        if (detail.message) {
          setStatusMessage(detail.message)
        }

        if (detail.status === 'succeeded' || detail.output_pdf_ready) {
          setProgress(100)
          break
        }

        if (detail.status === 'failed' || detail.status === 'canceled') {
          throw new Error(detail?.message || 'Công việc dịch thất bại. Hãy kiểm tra khóa API trong Phần Cài đặt.')
        }

        await new Promise((resolve) => window.setTimeout(resolve, 2500))
      }

      const outputUrl = `/api/v1/jobs/${encodeURIComponent(job.job_id)}/pdf`
      if (detail?.status === 'succeeded' || detail?.output_pdf_ready) {
        setTranslatedPdfUrl(outputUrl)
        setStatusMessage('Hoàn tất dịch! PDF dịch đã sẵn sàng bên dưới.')
      } else {
        setStatusMessage('Tiến trình đang hoàn tất. Bạn có thể bấm xem thử bên dưới sau vài giây.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể khởi tạo quy trình dịch.'
      setErrorMessage(message)
      setStatusMessage('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <Sparkles className="size-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Bảo lưu cấu trúc bố cục MinerU</div>
            <div className="text-xs text-slate-400">Google Translate với tự động chia đoạn nhỏ</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-700"
        >
          <Settings className="size-4 text-cyan-400" />
          <span>Cấu hình API Key</span>
        </button>
      </div>

      {/* Settings Modal / Drawer */}
      {showSettings && (
        <div className="rounded-3xl border border-cyan-500/30 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-cyan-400">
              <Key className="size-4" />
              Thiết lập Khóa API (MinerU & Gemini)
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Đóng ✕
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-300">Translation Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                {PROVIDERS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">Google Gemini API Key <span className="text-cyan-400 font-normal">(AI Studio)</span></label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
                placeholder="AQ...."
              />
              <p className="mt-1 text-[10px] text-slate-500">Lấy key miễn phí tại <span className="text-cyan-500">aistudio.google.com</span></p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">MinerU AK (Access Key)</label>
              <input
                type="text"
                value={mineruAk}
                onChange={(e) => setMineruAk(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-300">MinerU SK (Secret Key)</label>
              <input
                type="password"
                value={mineruSk}
                onChange={(e) => setMineruSk(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={testApiKeys}
              disabled={testingKeys}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600/20 px-3.5 py-1.5 text-xs font-medium text-cyan-300 border border-cyan-500/40 hover:bg-cyan-600/30"
            >
              {testingKeys ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
              Kiểm tra kết nối API
            </button>
            <span className="text-[11px] text-slate-400">Các key được lưu và sử dụng cho máy chủ hiện tại.</span>
          </div>

          {keyTestStatus && (
            <div className="mt-3 rounded-xl bg-slate-950 p-2.5 text-xs font-mono text-slate-300 border border-slate-800">
              {keyTestStatus}
            </div>
          )}
        </div>
      )}

      {/* Main Upload Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 transition-all ${
            isDragOver
              ? 'border-cyan-400 bg-cyan-950/20 shadow-xl shadow-cyan-500/10'
              : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80'
          }`}
        >
          <input
            type="file"
            accept="application/pdf"
            id="pdf-input"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                setFile(e.target.files[0])
                setErrorMessage('')
              }
            }}
          />

          <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-800/80 text-cyan-400 border border-slate-700 shadow-inner">
            <Upload className="size-7" />
          </div>

          <div className="mt-4 text-center">
            <p className="text-base font-semibold text-slate-200">
              Kéo thả file PDF vào đây hoặc <span className="text-cyan-400 underline decoration-cyan-400/50 underline-offset-4">Chọn từ máy</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">Hỗ trợ các file sách, tài liệu nghiên cứu, PDF phức tạp nhiều cột & công thức.</p>
          </div>

          {file && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-950/40 px-4 py-2.5 text-xs text-cyan-200 backdrop-blur-sm">
              <FileText className="size-4 text-cyan-400" />
              <span className="font-semibold">{file.name}</span>
              <span className="text-cyan-400/70">({Math.round(file.size / 1024)} KB)</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                }}
                className="ml-2 text-xs font-bold text-slate-400 hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Options Row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 backdrop-blur-md">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Globe className="size-4 text-cyan-400" />
              <span>Ngôn ngữ cần dịch sang</span>
            </label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 backdrop-blur-md">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Sparkles className="size-4 text-cyan-400" />
              <span>Provider đang dùng</span>
            </label>
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200">
              {PROVIDERS.find((option) => option.code === provider)?.label ?? provider}
            </div>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={!file || isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  <span>Đang xử lý dịch PDF...</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-5" />
                  <span>Bắt đầu Dịch PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Progress & Error Displays */}
      {isSubmitting && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-cyan-400 flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-cyan-400" />
              Tiến trình xử lý dịch
            </span>
            <span className="text-slate-300 font-mono">{progress}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-950 border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-mono">{statusMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-4 text-xs text-rose-300 backdrop-blur-md">
          <AlertCircle className="size-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-rose-200">Xảy ra lỗi trong quá trình dịch</div>
            <div className="mt-1 leading-relaxed">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* Translated Result Card */}
      {translatedPdfUrl && (
        <div className="rounded-3xl border border-emerald-500/30 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="size-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Bản dịch PDF đã sẵn sàng!</h3>
                <p className="text-xs text-slate-400">Đã hoàn tất giữ nguyên bố cục và cấu trúc bản gốc.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={translatedPdfUrl}
                download
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 transition"
              >
                <Download className="size-4" />
                Tải xuống PDF Dịch (.pdf)
              </a>
            </div>
          </div>

          {/* Embedded Viewer */}
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <iframe
              title="PDF Translated Preview"
              src={translatedPdfUrl}
              className="h-[75vh] w-full border-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}
