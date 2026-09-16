import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Columns2,
  List,
  Minus,
  Plus,
  ScrollText,
} from 'lucide-react'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { BookSection, Highlight } from '../api/books'
import { Button } from '../components/ui/button'
import type { ReaderMode } from './preferences'
import './pdf-reader.css'

GlobalWorkerOptions.workerSrc = pdfWorker

type PdfOutlineNode = {
  title: string
  dest: string | unknown[] | null
  items: PdfOutlineNode[]
}

type PdfOutlineEntry = {
  title: string
  page: number | null
  level: number
}

type PdfReaderProps = {
  bookId: string
  title: string
  sections: BookSection[]
  activeOffset: number
  mode: ReaderMode
  viewportRef: RefObject<HTMLElement | null>
  searchQuery: string
  highlights: Highlight[]
  hasTextLayer: boolean
  sourceUrl?: string
  textLength?: number
  mapPagesByProgress?: boolean
  onModeChange: (mode: ReaderMode) => void
  onActiveOffset: (offset: number, source: 'user' | 'programmatic') => void
  onSelection: () => void
}

function sectionForPage(sections: BookSection[], page: number) {
  return sections[Math.min(sections.length - 1, Math.max(0, page - 1))]
}

function pageForOffset(sections: BookSection[], offset: number) {
  const index = sections.findIndex(
    (section, sectionIndex) =>
      offset >= section.startOffset &&
      (offset < section.endOffset || sectionIndex === sections.length - 1),
  )
  return Math.max(1, (index < 0 ? 0 : index) + 1)
}

async function outlineEntries(
  pdf: PDFDocumentProxy,
  nodes: PdfOutlineNode[],
  level = 0,
): Promise<PdfOutlineEntry[]> {
  const result: PdfOutlineEntry[] = []
  for (const node of nodes) {
    let destination = node.dest
    if (typeof destination === 'string')
      destination = await pdf.getDestination(destination)
    let page: number | null = null
    if (Array.isArray(destination) && destination.length) {
      const reference = destination[0]
      if (typeof reference === 'number') page = reference + 1
      else if (reference && typeof reference === 'object') {
        try {
          page =
            (await pdf.getPageIndex(
              reference as { num: number; gen: number },
            )) + 1
        } catch {
          page = null
        }
      }
    }
    result.push({ title: node.title || 'Раздел', page, level })
    result.push(...(await outlineEntries(pdf, node.items ?? [], level + 1)))
  }
  return result
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  rootRef,
  baseOffset,
  searchQuery,
  highlights,
  onVisible,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  rootRef: RefObject<HTMLElement | null>
  baseOffset: number
  searchQuery: string
  highlights: Highlight[]
  onVisible: (page: number) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 595, height: 842 })
  const [renderError, setRenderError] = useState('')

  useEffect(() => {
    const element = host.current
    if (!element) return
    const root = rootRef.current
    const lazyObserver = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { root, rootMargin: '1200px 0px', threshold: 0 },
    )
    const visibleObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible(pageNumber)
      },
      { root, threshold: 0.55 },
    )
    lazyObserver.observe(element)
    visibleObserver.observe(element)
    return () => {
      lazyObserver.disconnect()
      visibleObserver.disconnect()
    }
  }, [onVisible, pageNumber, rootRef])

  useEffect(() => {
    if (!nearViewport || !canvas.current || !text.current) return
    let cancelled = false
    let page: PDFPageProxy | null = null
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let layer: TextLayer | null = null
    const textHost = text.current
    const canvasElement = canvas.current

    void (async () => {
      try {
        page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        setDimensions({ width: viewport.width, height: viewport.height })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        canvasElement.width = Math.floor(viewport.width * pixelRatio)
        canvasElement.height = Math.floor(viewport.height * pixelRatio)
        canvasElement.style.width = `${viewport.width}px`
        canvasElement.style.height = `${viewport.height}px`
        const context = canvasElement.getContext('2d')
        if (!context) throw new Error('Canvas недоступен')
        renderTask = page.render({
          canvas: canvasElement,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        await renderTask.promise
        if (cancelled) return

        textHost.replaceChildren()
        textHost.style.width = `${viewport.width}px`
        textHost.style.height = `${viewport.height}px`
        textHost.style.setProperty('--total-scale-factor', String(scale))
        const textContent = await page.getTextContent()
        if (cancelled) return
        layer = new TextLayer({
          textContentSource: textContent,
          container: textHost,
          viewport,
        })
        await layer.render()
        if (cancelled) return

        const needles = [
          searchQuery.trim(),
          ...highlights.map((item) => item.exactText.trim()),
        ].filter((value) => value.length >= 2)
        if (needles.length) {
          const chunks = layer.textContentItemsStr
          const ranges: Array<[number, number]> = []
          let joined = ''
          for (const chunk of chunks) {
            if (joined) joined += ' '
            const start = joined.length
            joined += chunk
            ranges.push([start, joined.length])
          }
          const normalizedJoined = joined.toLocaleLowerCase('ru-RU')
          for (const rawNeedle of needles) {
            const needle = rawNeedle
              .replace(/\s+/g, ' ')
              .toLocaleLowerCase('ru-RU')
            let from = 0
            while (from <= normalizedJoined.length - needle.length) {
              const match = normalizedJoined.indexOf(needle, from)
              if (match < 0) break
              const matchEnd = match + needle.length
              ranges.forEach(([start, end], index) => {
                if (start < matchEnd && end > match)
                  layer?.textDivs[index]?.classList.add('pdf-text-match')
              })
              from = match + Math.max(1, needle.length)
            }
          }
        }
        setRenderError('')
      } catch (error) {
        if (!cancelled)
          setRenderError(
            error instanceof Error
              ? error.message
              : 'Не удалось показать страницу',
          )
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      layer?.cancel()
      canvasElement.width = 1
      canvasElement.height = 1
      textHost.replaceChildren()
      page?.cleanup()
    }
  }, [highlights, nearViewport, pageNumber, pdf, scale, searchQuery])

  return (
    <article
      ref={host}
      className="pdf-page relative mx-auto shrink-0 overflow-hidden bg-white shadow-xl"
      style={{
        width: dimensions.width,
        minHeight: dimensions.height,
      }}
      aria-label={`Страница ${pageNumber}`}
      data-pdf-page={pageNumber}
    >
      <canvas ref={canvas} className="block" />
      <div
        ref={text}
        className="pdf-text-layer"
        data-reader-slice
        data-reader-text
        data-base={baseOffset}
      />
      {!nearViewport && (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
          Страница {pageNumber}
        </div>
      )}
      {renderError && (
        <p className="absolute inset-x-6 top-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {renderError}
        </p>
      )}
    </article>
  )
}

export function PdfReader({
  bookId,
  title,
  sections,
  activeOffset,
  mode,
  viewportRef,
  searchQuery,
  highlights,
  hasTextLayer,
  sourceUrl,
  textLength,
  mapPagesByProgress = false,
  onModeChange,
  onActiveOffset,
  onSelection,
}: PdfReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState('')
  const [scale, setScale] = useState(1.15)
  const [page, setPage] = useState(() => pageForOffset(sections, activeOffset))
  const [pageInput, setPageInput] = useState(String(page))
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const emittedPage = useRef(page)
  const pageNodes = useRef(new Map<number, HTMLElement>())

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setViewportWidth(viewport.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    measure()
    return () => observer.disconnect()
  }, [viewportRef])

  useEffect(() => {
    const task = getDocument({
      url: sourceUrl ?? `/api/books/${encodeURIComponent(bookId)}/original`,
      withCredentials: true,
    })
    let disposed = false
    void task.promise
      .then(async (document) => {
        if (disposed) {
          return
        }
        setPdf(document)
        try {
          const tree = (await document.getOutline()) as PdfOutlineNode[] | null
          if (!disposed && tree?.length)
            setOutline(await outlineEntries(document, tree))
        } catch {
          // A damaged optional outline must not prevent the PDF from opening.
        }
      })
      .catch((error: unknown) => {
        if (!disposed)
          setLoadError(
            error instanceof Error ? error.message : 'Не удалось открыть PDF',
          )
      })
    return () => {
      disposed = true
      task.destroy()
    }
  }, [bookId, sourceUrl])

  const pageCount = pdf?.numPages ?? sections.length
  const safePage = Math.min(Math.max(1, page), Math.max(1, pageCount))
  const offsetForPage = useCallback(
    (pageNumber: number) => {
      if (mapPagesByProgress) {
        if (pageCount <= 1) return 0
        return Math.round(
          ((pageNumber - 1) / (pageCount - 1)) * (textLength ?? 0),
        )
      }
      return sectionForPage(sections, pageNumber)?.startOffset ?? 0
    },
    [mapPagesByProgress, pageCount, sections, textLength],
  )
  const pageForActiveOffset = useCallback(
    (offset: number) => {
      if (mapPagesByProgress) {
        if (!textLength || pageCount <= 1) return 1
        return (
          Math.round(
            (Math.max(0, Math.min(textLength, offset)) / textLength) *
              (pageCount - 1),
          ) + 1
        )
      }
      return pageForOffset(sections, offset)
    },
    [mapPagesByProgress, pageCount, sections, textLength],
  )
  const visiblePages = useMemo(() => {
    if (!pdf) return []
    if (mode === 'scroll')
      return Array.from({ length: pdf.numPages }, (_, index) => index + 1)
    if (mode === 'spread') {
      const first = safePage % 2 === 1 ? safePage : safePage - 1
      return [first, first + 1].filter((value) => value <= pdf.numPages)
    }
    return [safePage]
  }, [mode, pdf, safePage])

  const selectPage = useCallback(
    (requested: number, userInitiated = true) => {
      const next = Math.min(Math.max(1, requested), Math.max(1, pageCount))
      emittedPage.current = next
      setPage(next)
      setPageInput(String(next))
      if (userInitiated) onActiveOffset(offsetForPage(next), 'user')
      if (mode === 'scroll')
        pageNodes.current.get(next)?.scrollIntoView({
          block: 'start',
          behavior: userInitiated ? 'smooth' : 'auto',
        })
    },
    [mode, offsetForPage, onActiveOffset, pageCount],
  )

  useEffect(() => {
    const target = pageForActiveOffset(activeOffset)
    if (target === emittedPage.current) return
    selectPage(target, false)
  }, [activeOffset, pageForActiveOffset, selectPage])

  const pageBecameVisible = useCallback(
    (visiblePage: number) => {
      if (mode !== 'scroll' || visiblePage === emittedPage.current) return
      emittedPage.current = visiblePage
      setPage(visiblePage)
      setPageInput(String(visiblePage))
      onActiveOffset(offsetForPage(visiblePage), 'user')
    },
    [mode, offsetForPage, onActiveOffset],
  )

  useEffect(() => {
    const changePage = (event: Event) => {
      const direction = (event as CustomEvent<-1 | 1>).detail
      selectPage(safePage + direction * (mode === 'spread' ? 2 : 1))
    }
    window.addEventListener('projectf:pdf-page', changePage)
    return () => window.removeEventListener('projectf:pdf-page', changePage)
  }, [mode, safePage, selectPage])

  if (loadError)
    return (
      <div
        className="m-6 rounded-2xl border border-danger/40 bg-danger-soft p-5"
        role="alert"
      >
        <h2 className="font-semibold">PDF не открылся</h2>
        <p className="mt-2 text-sm">{loadError}</p>
      </div>
    )
  if (!pdf)
    return (
      <p className="grid h-full place-items-center" role="status">
        Загружаем PDF…
      </p>
    )

  const step = mode === 'spread' ? 2 : 1
  return (
    <div className="relative min-h-full min-w-full w-max bg-[#737373]" onMouseUp={onSelection}>
      <div
        className="sticky left-0 top-0 z-20 box-border flex flex-wrap items-center justify-center gap-2 border-b border-line bg-surface/95 px-3 py-2 text-foreground shadow-sm backdrop-blur"
        style={{ width: viewportWidth || '100%' }}
      >
        <div className="flex items-center gap-1 rounded-xl border border-line p-1">
          {(
            [
              ['scroll', ScrollText, 'Прокрутка'],
              ['page', List, 'Страница'],
              ['spread', Columns2, 'Разворот'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-lg p-2 transition ${mode === value ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-subtle'}`}
              aria-label={label}
              title={label}
              onClick={() => onModeChange(value)}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-9 px-2.5"
            aria-label="Предыдущая страница"
            disabled={safePage <= 1}
            onClick={() => selectPage(safePage - step)}
          >
            <ChevronLeft size={17} />
          </Button>
          <form
            className="flex items-center gap-1 text-sm"
            onSubmit={(event) => {
              event.preventDefault()
              const value = Number(pageInput)
              if (Number.isInteger(value)) selectPage(value)
              else setPageInput(String(safePage))
            }}
          >
            <input
              aria-label="Номер страницы"
              className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-center tabular-nums"
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => setPageInput(String(safePage))}
            />
            <span className="whitespace-nowrap text-muted">из {pageCount}</span>
          </form>
          <Button
            variant="outline"
            className="h-9 px-2.5"
            aria-label="Следующая страница"
            disabled={safePage >= pageCount}
            onClick={() => selectPage(safePage + step)}
          >
            <ChevronRight size={17} />
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line p-1 text-sm tabular-nums">
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-subtle"
            aria-label="Уменьшить масштаб"
            onClick={() => setScale((value) => Math.max(0.65, value - 0.1))}
          >
            <Minus size={16} />
          </button>
          <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-subtle"
            aria-label="Увеличить масштаб"
            onClick={() => setScale((value) => Math.min(2.4, value + 0.1))}
          >
            <Plus size={16} />
          </button>
        </div>
        {!!outline.length && (
          <Button
            variant="outline"
            className="h-9"
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((value) => !value)}
          >
            <BookOpenText size={17} /> Оглавление
          </Button>
        )}
      </div>

      {!hasTextLayer && (
        <div className="mx-auto mt-4 max-w-3xl rounded-xl border border-amber-400/40 bg-amber-100/80 px-4 py-3 text-sm text-amber-950">
          В этом PDF нет текстового слоя. Страницы можно читать как изображения,
          но поиск и выделение текста недоступны. OCR оставлен отдельным этапом.
        </div>
      )}

      {outlineOpen && (
        <aside className="project-scrollbar fixed right-4 top-32 z-30 max-h-[65vh] w-[min(90vw,340px)] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-foreground shadow-2xl">
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            <h2 className="font-semibold">Оглавление PDF</h2>
            <button
              className="text-xs text-muted hover:text-foreground"
              onClick={() => setOutlineOpen(false)}
            >
              Закрыть
            </button>
          </div>
          {outline.map((item, index) => (
            <button
              key={`${item.title}-${index}`}
              type="button"
              disabled={item.page === null}
              className="flex w-full items-center gap-3 rounded-lg py-2 pr-2 text-left text-sm hover:bg-subtle disabled:opacity-50"
              style={{ paddingLeft: Math.min(5, item.level) * 14 + 8 }}
              onClick={() => {
                if (item.page !== null) selectPage(item.page)
                setOutlineOpen(false)
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {item.page !== null && (
                <span className="text-xs tabular-nums text-muted">
                  {item.page}
                </span>
              )}
            </button>
          ))}
        </aside>
      )}

      <div
        className={`pdf-pages mx-auto min-h-full gap-6 p-4 sm:p-7 ${mode === 'spread' ? 'grid w-max grid-cols-2 items-start' : 'flex w-max flex-col'}`}
        aria-label={`PDF «${title}»`}
      >
        {visiblePages.map((pageNumber) => (
          <div
            key={pageNumber}
            ref={(element) => {
              if (element) pageNodes.current.set(pageNumber, element)
              else pageNodes.current.delete(pageNumber)
            }}
            className="scroll-mt-20"
          >
            <PdfPage
              pdf={pdf}
              pageNumber={pageNumber}
              scale={scale}
              rootRef={viewportRef}
              baseOffset={
                mapPagesByProgress
                  ? offsetForPage(pageNumber)
                  : (sectionForPage(sections, pageNumber)?.startOffset ?? 0) +
                    `${sectionForPage(sections, pageNumber)?.title ?? ''}\n\n`
                      .length
              }
              searchQuery={searchQuery}
              highlights={highlights.filter((item) => {
                const start = offsetForPage(pageNumber)
                const end =
                  pageNumber >= pageCount
                    ? (textLength ?? sections.at(-1)?.endOffset ?? start)
                    : offsetForPage(pageNumber + 1)
                return item.startOffset < end && item.endOffset > start
              })}
              onVisible={pageBecameVisible}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
