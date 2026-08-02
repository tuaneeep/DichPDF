import { LibraryUploadPanel } from '@/features/library/components/library-upload-panel'
import { Cpu, Languages, Layers } from 'lucide-react'

export default function App() {
  return (
    <main className="min-h-screen bg-[#090d16] text-slate-100 selection:bg-cyan-500 selection:text-white px-4 py-8 md:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        
        {/* Header Hero Section */}
        <header className="relative text-center space-y-4 pt-4">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-12 w-96 h-48 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 blur-3xl pointer-events-none rounded-full" />
          
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-4 py-1.5 text-xs font-semibold text-cyan-300 shadow-inner">
            <span className="flex size-2 rounded-full bg-cyan-400 animate-pulse" />
            PDF AI Translator Engine
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Dịch PDF Giữ Nguyên Bố Cục
          </h1>

          <p className="mx-auto max-w-2xl text-sm sm:text-base text-slate-400 font-normal leading-relaxed">
            Tải PDF lên để phân tích bố cục chuyên sâu bằng <span className="text-cyan-400 font-semibold">MinerU OCR</span>, dịch tự động với <span className="text-blue-400 font-semibold">Google Gemini AI</span> và tải về PDF đã hoàn tất dịch.
          </p>

          {/* Feature Badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
              <Cpu className="size-3.5 text-cyan-400" />
              <span>MinerU Precision OCR</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
              <Languages className="size-3.5 text-blue-400" />
              <span>Gemini AI Translation</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
              <Layers className="size-3.5 text-indigo-400" />
              <span>Bảo lưu bảng & công thức toán</span>
            </div>
          </div>
        </header>

        {/* Main Translator Panel */}
        <LibraryUploadPanel />

        {/* Footer */}
        <footer className="text-center text-xs text-slate-500 pt-8 border-t border-slate-900">
          <p>© PDF Translation App. Tích hợp MinerU OpenXLab &amp; Google Gemini AI.</p>
        </footer>

      </div>
    </main>
  )
}
