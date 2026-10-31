import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import type { BookSection } from '../api/books'
import type { MaterialSection } from '../api/documents'
import type { ReaderMode } from './preferences'

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
)
const DocxReader = lazy(() =>
  import('./DocxReader').then((module) => ({ default: module.DocxReader })),
)

type DocumentOriginalViewerProps = {
  documentId: string
  title: string
  sourceType: string
  sections: MaterialSection[]
  textLength: number
  activeOffset: number
  onActiveOffset: (offset: number) => void
}

export function DocumentOriginalViewer({
  documentId,
  title,
  sourceType,
  sections,
  textLength,
  activeOffset,
  onActiveOffset,
}: DocumentOriginalViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ReaderMode>('scroll')
  const readerSections = useMemo<BookSection[]>(() => {
    const mapped = sections.map((section) => ({
      ...section,
      tocLevel: 0,
    }))
    if (mapped.length) return mapped
    return [
      {
        number: 0,
        title,
        role: 'main',
        startOffset: 0,
        endOffset: Math.max(1, textLength),
        tocLevel: 0,
      },
    ]
  }, [sections, textLength, title])
  const format = sourceType.toLocaleLowerCase('ru-RU')
  const updateOffset = (offset: number) => onActiveOffset(offset)

  return (
    <div
      ref={viewportRef}
      className="project-scrollbar h-[min(78vh,900px)] min-h-[560px] overflow-auto rounded-2xl border border-line bg-[#737373] shadow-inner"
    >
      <Suspense
        fallback={
          <p
            className="grid min-h-full place-items-center bg-surface text-muted"
            role="status"
          >
            Открываем оригинал документа…
          </p>
        }
      >
        {format === 'pdf' ? (
          <PdfReader
            bookId={documentId}
            title={title}
            sections={readerSections}
            textLength={textLength}
            activeOffset={activeOffset}
            mode={mode}
            viewportRef={viewportRef}
            searchQuery=""
            highlights={[]}
            hasTextLayer
            onModeChange={setMode}
            onActiveOffset={updateOffset}
            onSelection={() => undefined}
          />
        ) : (
          <DocxReader
            bookId={documentId}
            title={title}
            sections={readerSections}
            textLength={textLength}
            activeOffset={activeOffset}
            viewportRef={viewportRef}
            searchQuery=""
            highlights={[]}
            onActiveOffset={updateOffset}
            onSelection={() => undefined}
          />
        )}
      </Suspense>
    </div>
  )
}
