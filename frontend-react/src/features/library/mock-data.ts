import type { LibraryActivity, LibraryBook, LibraryBookArtifact } from './types'

const defaultArtifacts: LibraryBookArtifact[] = [
  { key: 'source', label: '原始 PDF', state: 'ready', detail: '保留原始上传文件' },
  { key: 'translated', label: '译文 PDF', state: 'processing', detail: '等待渲染完成' },
  { key: 'bilingual', label: '对照 PDF', state: 'queued', detail: '渲染后生成' },
]

function buildBookDetail(index: number, pages: number, status: LibraryBook['status']): LibraryBook['detail'] {
  return {
    sourceLanguage: '英文',
    targetLanguage: 'Tiếng Việt',
    workflow: pages > 500 ? 'book' : 'paper',
    ocrProvider: pages > 300 ? 'PaddleOCR' : 'MinerU',
    translationEngine: 'DeepSeek',
    fileSize: `${Math.max(8, Math.round(pages * 0.18))} MB`,
    createdAt: index === 0 ? '今天 00:42' : `${(index % 23) + 1}: ${(index * 11) % 60}`.replace(': ', ':'),
    description: status === 'ready' ? '已完成翻译和对照 PDF 生成，可进入对照阅读。' : status === 'processing' ? '正在处理书籍内容，翻译结果会在任务完成后进入书架。' : '任务已加入队列，等待可用执行槽位。',
    tags: pages > 800 ? ['长文档', '图书', '对照翻译'] : ['PDF', '翻译'],
    artifacts: defaultArtifacts.map((artifact) => {
      if (status === 'ready') {
        return { ...artifact, state: 'ready', detail: '已生成' }
      }
      if (status === 'processing' && artifact.key === 'source') {
        return { ...artifact, state: 'ready', detail: '已上传' }
      }
      return artifact
    }),
  }
}

const seedBooks: LibraryBook[] = [
  {
    id: 'quantum-spectroscopy',
    title: 'Quantum Chemistry & Spectroscopy',
    authors: 'Thomas Engel',
    pages: 533,
    status: 'processing',
    updatedAt: '刚刚',
    progressLabel: '渲染准备中，共 533 页',
    coverTone: 'dark',
    detail: buildBookDetail(0, 533, 'processing'),
    snapshot: {
      activeStage: 'render',
      selectedStage: 'render',
      elapsedText: '12分 18秒',
      stageProgress: {
        ocr: { current: 533, total: 533, text: '第 533/533 页' },
        translate: {
          current: 5216,
          total: 5216,
          text: '第 5216/5216 批',
          substageKey: 'translation_batches',
        },
        render: { current: 0, total: 533, text: '渲染准备中，共 533 页' },
      },
    },
  },
  {
    id: 'molecular-biology',
    title: 'Molecular Biology of the Cell',
    authors: 'Bruce Alberts',
    pages: 1464,
    status: 'ready',
    updatedAt: '今天 01:12',
    progressLabel: '已生成对照 PDF',
    coverTone: 'medium',
    detail: buildBookDetail(1, 1464, 'ready'),
    snapshot: {
      activeStage: 'done',
      selectedStage: 'done',
      elapsedText: '完成',
      pdfReady: true,
      readerReady: true,
      stageProgress: {
        ocr: { current: 1464, total: 1464, text: '第 1464/1464 页' },
        translate: { current: 8820, total: 8820, text: '第 8820/8820 批' },
        render: { current: 1464, total: 1464, text: '第 1464/1464 页' },
      },
    },
  },
  {
    id: 'statistical-learning',
    title: 'The Elements of Statistical Learning',
    authors: 'Hastie, Tibshirani, Friedman',
    pages: 745,
    status: 'queued',
    updatedAt: '队列中',
    progressLabel: '等待可用执行槽位',
    coverTone: 'light',
    detail: buildBookDetail(2, 745, 'queued'),
    snapshot: {
      activeStage: 'ocr',
      selectedStage: 'ocr',
      elapsedText: '排队中',
      stageProgress: {
        ocr: { text: '等待开始', indeterminate: true },
      },
    },
  },
]

const titlePrefixes = [
  'Modern',
  'Applied',
  'Advanced',
  'Foundations of',
  'Introduction to',
  'Principles of',
  'Handbook of',
  'Computational',
  'Experimental',
  'Selected Topics in',
]

const titleSubjects = [
  'Quantum Mechanics',
  'Statistical Physics',
  'Organic Chemistry',
  'Machine Learning',
  'Numerical Analysis',
  'Molecular Genetics',
  'Signal Processing',
  'Linear Algebra',
  'Thermodynamics',
  'Scientific Computing',
]

const authors = [
  'A. Chen',
  'M. Anderson',
  'L. Zhang',
  'S. Patel',
  'E. Fischer',
  'K. Tanaka',
  'R. Williams',
  'Y. Nakamura',
  'D. Smith',
  'H. Martin',
]

function buildGeneratedBook(index: number): LibraryBook {
  const title = `${titlePrefixes[index % titlePrefixes.length]} ${titleSubjects[index % titleSubjects.length]}`
  const pages = 180 + ((index * 37) % 1320)
  const status = index % 13 === 0 ? 'queued' : index % 7 === 0 ? 'processing' : 'ready'
  const coverTone = index % 3 === 0 ? 'dark' : index % 3 === 1 ? 'medium' : 'light'
  const translatedBatches = pages * 6
  const renderCurrent = status === 'ready' ? pages : status === 'processing' ? Math.floor(pages * ((index % 9) / 10)) : 0
  const progressLabel = status === 'ready'
    ? '已生成对照 PDF'
    : status === 'processing'
      ? `第 ${renderCurrent}/${pages} 页`
      : '等待可用执行槽位'

  return {
    id: `generated-book-${String(index + 1).padStart(3, '0')}`,
    title,
    authors: authors[index % authors.length],
    pages,
    status,
    updatedAt: status === 'ready' ? `${(index % 23) + 1}: ${(index * 7) % 60}`.replace(': ', ':') : status === 'processing' ? '处理中' : '队列中',
    progressLabel,
    coverTone,
    detail: buildBookDetail(index + seedBooks.length, pages, status),
    snapshot: {
      activeStage: status === 'ready' ? 'done' : status === 'processing' ? 'render' : 'ocr',
      selectedStage: status === 'ready' ? 'done' : status === 'processing' ? 'render' : 'ocr',
      elapsedText: status === 'ready' ? '完成' : status === 'processing' ? `${(index % 18) + 2}分` : '排队中',
      pdfReady: status === 'ready',
      readerReady: status === 'ready',
      stageProgress: {
        ocr: status === 'queued' ? { text: '等待开始', indeterminate: true } : { current: pages, total: pages, text: `第 ${pages}/${pages} 页` },
        translate: status === 'queued' ? undefined : { current: translatedBatches, total: translatedBatches, text: `第 ${translatedBatches}/${translatedBatches} 批` },
        render: status === 'ready'
          ? { current: pages, total: pages, text: `第 ${pages}/${pages} 页` }
          : status === 'processing'
            ? { current: renderCurrent, total: pages, text: renderCurrent > 0 ? `第 ${renderCurrent}/${pages} 页` : `渲染准备中，共 ${pages} 页` }
            : undefined,
      },
    },
  }
}

const generatedBooks = Array.from({ length: 500 - seedBooks.length }, (_, index) => buildGeneratedBook(index))

export const libraryBooks: LibraryBook[] = [...seedBooks, ...generatedBooks]

export const libraryActivities: LibraryActivity[] = [
  {
    id: 'activity-render',
    title: '渲染阶段启动',
    detail: 'Quantum Chemistry & Spectroscopy 正在准备页面叠加。',
    time: '刚刚',
  },
  {
    id: 'activity-ready',
    title: 'PDF 已完成',
    detail: 'Molecular Biology of the Cell 已进入对照阅读。',
    time: '01:12',
  },
  {
    id: 'activity-queued',
    title: '新书加入书架',
    detail: 'The Elements of Statistical Learning 等待处理。',
    time: '00:58',
  },
]
