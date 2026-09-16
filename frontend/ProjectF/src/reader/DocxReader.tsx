import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { renderAsync } from 'docx-preview'
import type { BookSection, Highlight } from '../api/books'
import { Button } from '../components/ui/button'
import type { ReaderMode } from './preferences'
import './docx-reader.css'

const PdfReader = lazy(() =>
  import('./PdfReader').then((module) => ({ default: module.PdfReader })),
)

type DocxReaderProps = {
  bookId: string
  title: string
  sections: BookSection[]
  textLength: number
  activeOffset: number
  viewportRef: RefObject<HTMLElement | null>
  searchQuery: string
  highlights: Highlight[]
  onActiveOffset: (offset: number, source: 'user' | 'programmatic') => void
  onSelection: () => void
}

type HighlightRegistry = {
  set: (name: string, value: unknown) => void
  delete: (name: string) => void
}

function sectionIndexForOffset(sections: BookSection[], offset: number) {
  const index = sections.findIndex(
    (section, sectionIndex) =>
      offset >= section.startOffset &&
      (offset < section.endOffset || sectionIndex === sections.length - 1),
  )
  return index < 0 ? 0 : index
}

function rangesForText(root: HTMLElement, needles: string[]) {
  const ranges: Range[] = []
  const normalized = needles
    .map((value) => value.trim().toLocaleLowerCase('ru-RU'))
    .filter((value) => value.length >= 2)
  if (!normalized.length) return ranges
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    const lower = text.toLocaleLowerCase('ru-RU')
    for (const needle of normalized) {
      let from = 0
      while (from <= lower.length - needle.length) {
        const index = lower.indexOf(needle, from)
        if (index < 0) break
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + needle.length)
        ranges.push(range)
        from = index + needle.length
      }
    }
  }
  return ranges
}

export function DocxReader({
  bookId,
  title,
  sections,
  textLength,
  activeOffset,
  viewportRef,
  searchQuery,
  highlights,
  onActiveOffset,
  onSelection,
}: DocxReaderProps) {
  const content = useRef<HTMLDivElement>(null)
  const styles = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [pageCount, setPageCount] = useState(1)
  const [scale, setScale] = useState(1)
  const [previewUrl, setPreviewUrl] = useState('')
  const [fallbackPreview, setFallbackPreview] = useState(false)
  const [pdfMode, setPdfMode] = useState<ReaderMode>('scroll')
  const pageElements = useRef<HTMLElement[]>([])
  const headingElements = useRef<HTMLElement[]>([])
  const emittedPage = useRef(0)
  const emittedOffset = useRef(-1)

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const contentElement = content.current
    const stylesElement = styles.current
    if (!contentElement || !stylesElement) return
    let previewObjectUrl = ''
    emittedOffset.current = -1
    void (async () => {
      try {
        const previewResponse = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/preview`,
          { credentials: 'same-origin', signal: controller.signal },
        )
        if (previewResponse.ok) {
          previewObjectUrl = URL.createObjectURL(await previewResponse.blob())
          if (disposed) return
          setPreviewUrl(previewObjectUrl)
          setLoading(false)
          return
        }
        if (previewResponse.status === 401)
          window.dispatchEvent(new Event('session-expired'))
        setFallbackPreview(true)
        const response = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/original`,
          { credentials: 'same-origin', signal: controller.signal },
        )
        if (!response.ok) {
          if (response.status === 401)
            window.dispatchEvent(new Event('session-expired'))
          throw new Error('Не удалось загрузить оригинал DOCX')
        }
        const blob = await response.blob()
        if (disposed) return
        contentElement.replaceChildren()
        stylesElement.replaceChildren()
        await renderAsync(blob, contentElement, stylesElement, {
          className: 'projectf-docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderAltChunks: true,
          experimental: true,
          useBase64URL: true,
        })
        if (disposed) return
        pageElements.current = Array.from(
          contentElement.querySelectorAll<HTMLElement>('section.projectf-docx'),
        )
        if (!pageElements.current.length)
          pageElements.current = [contentElement]
        headingElements.current = Array.from(
          contentElement.querySelectorAll<HTMLElement>(
            'h1, h2, h3, h4, h5, h6',
          ),
        )
        setPageCount(pageElements.current.length)
        setLoading(false)
      } catch (reason) {
        if (disposed || controller.signal.aborted) return
        setError(
          reason instanceof Error
            ? reason.message
            : 'Не удалось показать документ DOCX',
        )
        setLoading(false)
      }
    })()
    return () => {
      disposed = true
      controller.abort()
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
      contentElement.replaceChildren()
      stylesElement.replaceChildren()
      pageElements.current = []
      headingElements.current = []
    }
  }, [bookId])

  const selectPage = useCallback(
    (
      requested: number,
      behavior: ScrollBehavior = 'smooth',
      updateProgress = true,
    ) => {
      const next = Math.min(Math.max(1, requested), pageCount)
      const element = pageElements.current[next - 1]
      if (!element) return
      emittedPage.current = next
      setPage(next)
      setPageInput(String(next))
      element.scrollIntoView({ block: 'start', behavior })
      const ratio = pageCount <= 1 ? 0 : (next - 1) / (pageCount - 1)
      const offset = Math.round(ratio * textLength)
      if (updateProgress) {
        emittedOffset.current = offset
        onActiveOffset(offset, 'user')
      }
    },
    [onActiveOffset, pageCount, textLength],
  )

  useEffect(() => {
    if (loading || error || !pageElements.current.length) return
    const root = viewportRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        const visiblePage =
          pageElements.current.indexOf(visible.target as HTMLElement) + 1
        if (visiblePage <= 0 || visiblePage === emittedPage.current) return
        emittedPage.current = visiblePage
        setPage(visiblePage)
        setPageInput(String(visiblePage))
        const ratio = pageCount <= 1 ? 0 : (visiblePage - 1) / (pageCount - 1)
        const offset = Math.round(ratio * textLength)
        emittedOffset.current = offset
        onActiveOffset(offset, 'user')
      },
      { root, threshold: [0.35, 0.6] },
    )
    pageElements.current.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [error, loading, onActiveOffset, pageCount, textLength, viewportRef])

  useEffect(() => {
    if (loading || error || activeOffset === emittedOffset.current) return
    const sectionIndex = sectionIndexForOffset(sections, activeOffset)
    const heading = headingElements.current[sectionIndex]
    if (heading) {
      heading.scrollIntoView({ block: 'start', behavior: 'auto' })
      const hostPage = heading.closest<HTMLElement>('section.projectf-docx')
      const index = hostPage ? pageElements.current.indexOf(hostPage) : -1
      if (index >= 0) {
        emittedPage.current = index + 1
        emittedOffset.current = activeOffset
        setPage(index + 1)
        setPageInput(String(index + 1))
      }
      return
    }
    const ratio = textLength ? activeOffset / textLength : 0
    emittedOffset.current = activeOffset
    selectPage(
      Math.round(ratio * Math.max(0, pageCount - 1)) + 1,
      'auto',
      false,
    )
  }, [
    activeOffset,
    error,
    loading,
    pageCount,
    sections,
    selectPage,
    textLength,
  ])

  useEffect(() => {
    const root = content.current
    const css = CSS as typeof CSS & { highlights?: HighlightRegistry }
    const HighlightConstructor = (
      window as typeof window & {
        Highlight?: new (...ranges: Range[]) => unknown
      }
    ).Highlight
    if (!root || !css.highlights || !HighlightConstructor) return
    const searchRanges = rangesForText(root, [searchQuery])
    const annotationRanges = rangesForText(
      root,
      highlights.map((item) => item.exactText),
    )
    if (searchRanges.length)
      css.highlights.set(
        'projectf-docx-search',
        new HighlightConstructor(...searchRanges),
      )
    else css.highlights.delete('projectf-docx-search')
    if (annotationRanges.length)
      css.highlights.set(
        'projectf-docx-annotations',
        new HighlightConstructor(...annotationRanges),
      )
    else css.highlights.delete('projectf-docx-annotations')
    return () => {
      css.highlights?.delete('projectf-docx-search')
      css.highlights?.delete('projectf-docx-annotations')
    }
  }, [highlights, loading, searchQuery])

  if (previewUrl)
    return (
      <Suspense
        fallback={
          <p className="grid h-full place-items-center" role="status">
            Открываем страницы DOCX…
          </p>
        }
      >
        <PdfReader
          bookId={bookId}
          title={title}
          sections={sections}
          textLength={textLength}
          activeOffset={activeOffset}
          mode={pdfMode}
          viewportRef={viewportRef}
          searchQuery={searchQuery}
          highlights={highlights}
          hasTextLayer
          sourceUrl={previewUrl}
          mapPagesByProgress
          onModeChange={setPdfMode}
          onActiveOffset={onActiveOffset}
          onSelection={onSelection}
        />
      </Suspense>
    )

  return (
    <div className="docx-reader min-h-full" onMouseUp={onSelection}>
      <div ref={styles} aria-hidden="true" />
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-2 border-b border-line bg-surface/95 px-3 py-2 text-foreground shadow-sm backdrop-blur">
        <Button
          variant="outline"
          className="h-9 px-2.5"
          aria-label="Предыдущая страница"
          disabled={page <= 1 || loading}
          onClick={() => selectPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </Button>
        <form
          className="flex items-center gap-1 text-sm"
          onSubmit={(event) => {
            event.preventDefault()
            const value = Number(pageInput)
            if (Number.isInteger(value)) selectPage(value)
            else setPageInput(String(page))
          }}
        >
          <input
            aria-label="Номер страницы"
            className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-center tabular-nums"
            inputMode="numeric"
            value={pageInput}
            disabled={loading}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={() => setPageInput(String(page))}
          />
          <span className="whitespace-nowrap text-muted">из {pageCount}</span>
        </form>
        <Button
          variant="outline"
          className="h-9 px-2.5"
          aria-label="Следующая страница"
          disabled={page >= pageCount || loading}
          onClick={() => selectPage(page + 1)}
        >
          <ChevronRight size={17} />
        </Button>
        <div className="flex items-center gap-1 rounded-xl border border-line p-1 text-sm tabular-nums">
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-subtle"
            aria-label="Уменьшить масштаб"
            onClick={() => setScale((value) => Math.max(0.6, value - 0.1))}
          >
            <Minus size={16} />
          </button>
          <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-subtle"
            aria-label="Увеличить масштаб"
            onClick={() => setScale((value) => Math.min(2, value + 0.1))}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {loading && (
        <p className="grid min-h-[60vh] place-items-center" role="status">
          Восстанавливаем оформление DOCX…
        </p>
      )}
      {error && (
        <div
          className="m-6 rounded-2xl border border-danger/40 bg-danger-soft p-5"
          role="alert"
        >
          <h2 className="font-semibold">DOCX не открылся</h2>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      )}
      {fallbackPreview && !loading && !error && (
        <p className="mx-auto mt-4 max-w-3xl rounded-xl border border-amber-400/40 bg-amber-100/90 px-4 py-3 text-sm text-amber-950">
          Точная постраничная копия недоступна: серверный конвертер Word или
          LibreOffice не найден. Показываем совместимый просмотр DOCX.
        </p>
      )}
      <div
        ref={content}
        data-reader-slice
        data-reader-text
        data-base="0"
        aria-label={`Документ «${title}»`}
        className={loading || error ? 'hidden' : ''}
        style={{ '--docx-scale': scale } as CSSProperties}
      />
    </div>
  )
}
