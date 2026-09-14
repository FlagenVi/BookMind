import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  List,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Plus,
  ScrollText,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { booksApi, type BookTocEntry, type Highlight } from '../api/books'
import { Button } from '../components/ui/button'

type ReaderMode = 'scroll' | 'page' | 'spread'
type ReaderTheme = 'paper' | 'sepia' | 'night'
type ReaderFont = 'serif' | 'sans'
type Preferences = {
  mode: ReaderMode
  theme: ReaderTheme
  font: ReaderFont
  fontSize: number
  lineHeight: number
  width: number
}
type SelectionDraft = {
  startOffset: number
  endOffset: number
  exactText: string
}

const defaults: Preferences = {
  mode: 'scroll',
  theme: 'paper',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.7,
  width: 760,
}

function readPreferences(): Preferences {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem('reader-preferences') ?? '{}'),
    }
  } catch {
    return defaults
  }
}

const markColors: Record<Highlight['color'], string> = {
  yellow: 'bg-amber-200/70 text-inherit',
  green: 'bg-emerald-200/70 text-inherit',
  blue: 'bg-sky-200/70 text-inherit',
  pink: 'bg-pink-200/70 text-inherit',
}

function HighlightedText({
  text,
  baseOffset,
  highlights,
}: {
  text: string
  baseOffset: number
  highlights: Highlight[]
}) {
  const end = baseOffset + text.length
  const relevant = highlights
    .filter((item) => item.startOffset < end && item.endOffset > baseOffset)
    .sort((a, b) => a.startOffset - b.startOffset)
  const nodes: ReactNode[] = []
  let cursor = baseOffset
  for (const item of relevant) {
    const start = Math.max(cursor, item.startOffset, baseOffset)
    const itemEnd = Math.min(end, item.endOffset)
    if (start > cursor)
      nodes.push(text.slice(cursor - baseOffset, start - baseOffset))
    if (itemEnd > start) {
      nodes.push(
        <mark
          key={`${item.id}-${start}`}
          className={`rounded-sm ${markColors[item.color]}`}
          title={item.note || 'Выделение'}
        >
          {text.slice(start - baseOffset, itemEnd - baseOffset)}
        </mark>,
      )
      cursor = itemEnd
    }
  }
  if (cursor < end) nodes.push(text.slice(cursor - baseOffset))
  return nodes
}

export function ReaderPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [preferences, setPreferences] = useState(readPreferences)
  const [activeOffset, setActiveOffset] = useState(0)
  const [leftPanel, setLeftPanel] = useState<'toc' | 'marks' | null>(null)
  const [mainTocOpen, setMainTocOpen] = useState(true)
  const [extraTocOpen, setExtraTocOpen] = useState(false)
  const [collapsedToc, setCollapsedToc] = useState<Set<number>>(
    () => new Set(),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<SelectionDraft | null>(null)
  const [note, setNote] = useState('')
  const [color, setColor] = useState<Highlight['color']>('yellow')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [pageMetrics, setPageMetrics] = useState({ width: 0, height: 0 })
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [touchPaging, setTouchPaging] = useState(false)
  const initialized = useRef('')
  const readingArea = useRef<HTMLDivElement>(null)
  const readerViewport = useRef<HTMLElement>(null)
  const tocPanel = useRef<HTMLElement>(null)
  const pageFrame = useRef<HTMLDivElement>(null)
  const pagedContent = useRef<HTMLElement>(null)
  const gesture = useRef({ x: 0, y: 0, pointerId: -1, moved: false })
  const lastGesture = useRef(0)
  const activeOffsetRef = useRef(0)
  const readingStartedAt = useRef(0)

  const manifest = useQuery({
    queryKey: ['book', id, 'manifest'],
    queryFn: ({ signal }) => booksApi.manifest(id, signal),
  })
  const bookmarks = useQuery({
    queryKey: ['book', id, 'bookmarks'],
    queryFn: ({ signal }) => booksApi.bookmarks(id, signal),
  })
  const highlights = useQuery({
    queryKey: ['book', id, 'highlights'],
    queryFn: ({ signal }) => booksApi.highlights(id, signal),
  })

  useEffect(() => {
    localStorage.setItem('reader-preferences', JSON.stringify(preferences))
  }, [preferences])
  useEffect(() => {
    if (manifest.data && initialized.current !== id) {
      initialized.current = id
      setActiveOffset(manifest.data.positionOffset)
      readingStartedAt.current = Date.now()
    }
  }, [id, manifest.data])

  useEffect(() => {
    activeOffsetRef.current = activeOffset
  }, [activeOffset])

  const sections = manifest.data?.sections ?? []
  const exactSectionIndex = sections.findIndex(
    (item, index) =>
      activeOffset >= item.startOffset &&
      (activeOffset < item.endOffset || index === sections.length - 1),
  )
  const sectionIndex =
    exactSectionIndex >= 0
      ? exactSectionIndex
      : Math.max(
          0,
          sections.reduce(
            (found, item, index) =>
              activeOffset >= item.startOffset ? index : found,
            0,
          ),
        )
  const currentMeta = sections[sectionIndex]
  const tocEntries = manifest.data?.toc ?? []
  const tocIndex = Math.max(
    0,
    tocEntries.reduce(
      (found, item, index) =>
        activeOffset >= item.positionOffset ? index : found,
      0,
    ),
  )
  const currentToc = tocEntries[tocIndex]
  const mainToc = tocEntries.filter((item) => item.role === 'main')
  const extraToc = tocEntries.filter((item) => item.role === 'auxiliary')
  const section = useQuery({
    queryKey: ['book', id, 'section', currentMeta?.number],
    queryFn: ({ signal }) => booksApi.section(id, currentMeta!.number, signal),
    enabled:
      !!currentMeta &&
      manifest.data?.format !== 'pdf' &&
      preferences.mode !== 'scroll',
  })
  const scrollContent = useQuery({
    queryKey: ['book', id, 'content'],
    queryFn: ({ signal }) => booksApi.content(id, signal),
    enabled:
      manifest.data?.format !== 'pdf' && preferences.mode === 'scroll',
  })
  const pagesVisible =
    preferences.mode === 'spread' && pageMetrics.width >= 760 ? 2 : 1
  const columnGap = pagesVisible === 2 ? 48 : 64
  const pageWidth =
    pagesVisible === 2
      ? Math.max(1, (pageMetrics.width - columnGap) / 2)
      : Math.max(1, pageMetrics.width)

  useEffect(() => {
    if (preferences.mode !== 'scroll' || !scrollContent.data) return
    requestAnimationFrame(() => scrollToOffset(activeOffset, 'auto'))
    // Restore once after continuous content is loaded or scroll mode is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, preferences.mode, scrollContent.data])

  const saveProgress = useMutation({
    mutationFn: ({
      positionOffset,
      elapsedSeconds,
    }: {
      positionOffset: number
      elapsedSeconds: number
    }) => booksApi.saveProgress(id, { positionOffset, elapsedSeconds }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['books'] }),
  })

  const takeReadingSeconds = () => {
    if (document.visibilityState === 'hidden') return 0
    const now = Date.now()
    const seconds = Math.min(
      300,
      Math.max(0, Math.floor((now - readingStartedAt.current) / 1000)),
    )
    if (seconds) readingStartedAt.current += seconds * 1000
    return seconds
  }

  useEffect(() => {
    if (!manifest.data || initialized.current !== id) return
    const timer = window.setTimeout(
      () =>
        saveProgress.mutate({
          positionOffset: activeOffset,
          elapsedSeconds: takeReadingSeconds(),
        }),
      800,
    )
    return () => window.clearTimeout(timer)
    // A mutation identity changes between renders; the current offset is the intended trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOffset, id, manifest.data])

  useEffect(() => {
    if (!manifest.data || initialized.current !== id) return
    const persistReadingTime = () =>
      saveProgress.mutate({
        positionOffset: activeOffsetRef.current,
        elapsedSeconds: takeReadingSeconds(),
      })
    const timer = window.setInterval(persistReadingTime, 30_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const now = Date.now()
        const seconds = Math.min(
          300,
          Math.max(0, Math.floor((now - readingStartedAt.current) / 1000)),
        )
        readingStartedAt.current = now
        saveProgress.mutate({
          positionOffset: activeOffsetRef.current,
          elapsedSeconds: seconds,
        })
      } else {
        readingStartedAt.current = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', persistReadingTime)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', persistReadingTime)
      if (document.visibilityState === 'visible') {
        const seconds = Math.min(
          300,
          Math.max(
            0,
            Math.floor((Date.now() - readingStartedAt.current) / 1000),
          ),
        )
        if (seconds)
          void booksApi.saveProgress(id, {
            positionOffset: activeOffsetRef.current,
            elapsedSeconds: seconds,
          })
      }
    }
    // Progress mutation is intentionally sampled on a fixed interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manifest.data])

  const addBookmark = useMutation({
    mutationFn: () => {
      const activeContent =
        preferences.mode === 'scroll'
          ? scrollContent.data?.find(
              (item, index, items) =>
                activeOffset >= item.startOffset &&
                (activeOffset < item.endOffset || index === items.length - 1),
            )
          : section.data
      const content = activeContent?.content ?? ''
      const start = Math.max(
        0,
        activeOffset - (activeContent?.startOffset ?? 0),
      )
      const excerpt =
        content
          .slice(start, start + 180)
          .replace(/\s+/g, ' ')
          .trim() ||
        manifest.data?.title ||
        'Закладка'
      return booksApi.addBookmark(id, { positionOffset: activeOffset, excerpt })
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'bookmarks'],
      }),
  })
  const removeBookmark = useMutation({
    mutationFn: (bookmarkId: string) => booksApi.removeBookmark(id, bookmarkId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'bookmarks'],
      }),
  })
  const addHighlight = useMutation({
    mutationFn: (selection: SelectionDraft) =>
      booksApi.addHighlight(id, {
        ...selection,
        color,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setDraft(null)
      setNote('')
      window.getSelection()?.removeAllRanges()
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'highlights'],
      })
    },
  })
  const removeHighlight = useMutation({
    mutationFn: (highlightId: string) =>
      booksApi.removeHighlight(id, highlightId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'highlights'],
      }),
  })

  const progress = manifest.data?.textLength
    ? Math.min(100, Math.round((activeOffset / manifest.data.textLength) * 100))
    : 0

  const themeClass = {
    paper: 'bg-[#fbfaf7] text-[#292722]',
    sepia: 'bg-[#f3e6ca] text-[#483b2b]',
    night: 'bg-[#14191f] text-[#d9d6cf]',
  }[preferences.theme]
  const fontClass =
    preferences.font === 'serif'
      ? "font-[Georgia,'Times_New_Roman',serif]"
      : 'font-sans'

  function scrollToOffset(
    requestedOffset: number,
    behavior: ScrollBehavior = 'smooth',
  ) {
    const viewport = readerViewport.current
    const area = readingArea.current
    const content = scrollContent.data
    if (!viewport || !area || !manifest.data || !content?.length) return
    const offset = Math.max(
      0,
      Math.min(manifest.data.textLength, requestedOffset),
    )
    const target =
      content.find(
        (item, index) =>
          offset >= item.startOffset &&
          (offset < item.endOffset || index === content.length - 1),
      ) ?? content[0]
    const element = area.querySelector<HTMLElement>(
      `[data-section-number="${target.number}"]`,
    )
    if (!element) return
    const localOffset = Math.max(0, offset - target.startOffset)
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let remaining = localOffset
    let node = walker.nextNode() as Text | null
    let lastNode: Text | null = null
    while (node) {
      lastNode = node
      if (remaining <= node.data.length) break
      remaining -= node.data.length
      node = walker.nextNode() as Text | null
    }
    const targetNode = node ?? lastNode
    let targetRect = element.getBoundingClientRect()
    if (targetNode) {
      const range = document.createRange()
      const character = Math.min(remaining, targetNode.data.length)
      range.setStart(targetNode, character)
      range.collapse(true)
      targetRect = range.getClientRects()[0] ?? range.getBoundingClientRect()
      if (!targetRect.height && character < targetNode.data.length) {
        range.setEnd(targetNode, character + 1)
        targetRect = range.getBoundingClientRect()
      }
    }
    const top =
      viewport.scrollTop +
      targetRect.top -
      viewport.getBoundingClientRect().top -
      24
    viewport.scrollTo({ top: Math.max(0, top), behavior })
    setActiveOffset(offset)
  }

  function offsetFromScroll(viewport: HTMLElement) {
    if (viewport.scrollTop <= 2) return 0
    if (
      viewport.scrollTop + viewport.clientHeight >=
      viewport.scrollHeight - 3
    )
      return manifest.data?.textLength ?? activeOffsetRef.current
    const elements = Array.from(
      readingArea.current?.querySelectorAll<HTMLElement>(
        '[data-section-number]',
      ) ?? [],
    )
    if (!elements.length) return activeOffsetRef.current
    const targetY =
      viewport.getBoundingClientRect().top + viewport.clientHeight * 0.22
    const element =
      elements.find((item) => item.getBoundingClientRect().bottom >= targetY) ??
      elements[elements.length - 1]
    const rect = element.getBoundingClientRect()
    const ratio = Math.max(
      0,
      Math.min(1, (targetY - rect.top) / Math.max(1, rect.height)),
    )
    const start = Number(element.dataset.base ?? 0)
    const end = Number(element.dataset.end ?? start)
    return Math.round(start + (end - start) * ratio)
  }

  function columnForLocalOffset(localOffset: number) {
    const content = pagedContent.current
    if (!content || localOffset <= 0) return 0
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let remaining = localOffset
    let node = walker.nextNode() as Text | null
    let lastNode: Text | null = null
    while (node) {
      lastNode = node
      if (remaining <= node.data.length) break
      remaining -= node.data.length
      node = walker.nextNode() as Text | null
    }
    const target = node ?? lastNode
    if (!target) return 0
    const range = document.createRange()
    range.setStart(target, Math.min(remaining, target.data.length))
    range.collapse(true)
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    const left = rect.left - content.getBoundingClientRect().left
    return Math.max(0, Math.floor((left + 1) / (pageWidth + columnGap)))
  }

  function localOffsetForColumn(column: number) {
    const length = section.data?.content.length ?? 0
    if (column <= 0 || length === 0) return 0
    let low = 0
    let high = length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (columnForLocalOffset(middle) < column) low = middle + 1
      else high = middle
    }
    return low
  }

  function showPage(requested: number, behavior: ScrollBehavior = 'smooth') {
    if (!section.data || !pageFrame.current) return
    const lastGroup =
      Math.floor(Math.max(0, pageCount - 1) / pagesVisible) * pagesVisible
    const page = Math.min(
      lastGroup,
      Math.max(0, Math.floor(requested / pagesVisible) * pagesVisible),
    )
    setPageIndex(page)
    pageFrame.current.scrollTo({
      left: page * (pageWidth + columnGap),
      behavior,
    })
    setActiveOffset(
      Math.min(
        section.data.endOffset,
        section.data.startOffset + localOffsetForColumn(page),
      ),
    )
  }

  function move(direction: -1 | 1) {
    if (!currentMeta || !manifest.data) return
    if (preferences.mode === 'scroll') {
      const viewport = readerViewport.current
      if (!viewport) return
      viewport.scrollBy({
        top: direction * (viewport.clientHeight * 0.85),
        behavior: 'smooth',
      })
      return
    }
    const requested = pageIndex + direction * pagesVisible
    if (direction > 0 && requested < pageCount) {
      showPage(requested)
    } else if (direction < 0 && requested >= 0) {
      showPage(requested)
    } else if (direction > 0 && sectionIndex + 1 < sections.length) {
      setActiveOffset(sections[sectionIndex + 1].startOffset)
      setPageIndex(0)
    } else if (direction < 0 && sectionIndex > 0) {
      const previous = sections[sectionIndex - 1]
      setActiveOffset(Math.max(previous.startOffset, previous.endOffset - 1))
    }
  }

  function jumpToPercent(percent: number) {
    if (!manifest.data) return
    const offset = Math.round(
      manifest.data.textLength * Math.max(0, Math.min(100, percent)) * 0.01,
    )
    if (preferences.mode === 'scroll') scrollToOffset(offset)
    else setActiveOffset(offset)
  }

  function openOffsetFromPanel(offset: number) {
    setLeftPanel(null)
    if (preferences.mode === 'scroll') {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToOffset(offset)),
      )
    } else setActiveOffset(offset)
  }

  function openSection(item: BookTocEntry) {
    openOffsetFromPanel(item.positionOffset)
  }

  function sectionLabel(item: BookTocEntry, index: number) {
    const title = item.title?.replace(/\s+/g, ' ').trim()
    return title || `Глава ${index + 1}`
  }

  function tocGroup(
    label: string,
    items: BookTocEntry[],
    open: boolean,
    toggle: () => void,
  ) {
    if (!items.length) return null
    return (
      <section className="mt-2">
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-semibold transition hover:bg-subtle"
          onClick={toggle}
        >
          <ChevronDown
            size={17}
            className={`shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="text-xs font-normal tabular-nums text-muted">
            {items.length}
          </span>
        </button>
        {open && (
          <div className="relative ml-4 mt-1 space-y-0.5 border-l border-line pl-2">
            {items
              .filter((item, index) => {
                let ancestorLevel = item.level
                for (let previous = index - 1; previous >= 0; previous--) {
                  const candidate = items[previous]
                  if (candidate.level < ancestorLevel) {
                    if (collapsedToc.has(candidate.number)) return false
                    ancestorLevel = candidate.level
                    if (candidate.level === 0) break
                  }
                }
                return true
              })
              .map((item) => {
              const groupIndex = items.findIndex(
                (sectionItem) => sectionItem.number === item.number,
              )
              const index = tocEntries.findIndex(
                (sectionItem) => sectionItem.number === item.number,
              )
              const active = index === tocIndex
              const hasChildren =
                groupIndex + 1 < items.length &&
                items[groupIndex + 1].level > item.level
              const collapsed = collapsedToc.has(item.number)
              const position = manifest.data?.textLength
                ? Math.round((item.positionOffset / manifest.data.textLength) * 100)
                : 0
              return (
                <div
                  key={item.number}
                  data-toc-active={active || undefined}
                  title={sectionLabel(item, index)}
                  className={`group/toc relative flex w-full items-center rounded-lg py-0.5 pr-1 text-sm transition ${active ? 'bg-accent-soft font-medium text-accent' : 'text-secondary hover:bg-subtle hover:text-foreground'}`}
                  style={{ paddingLeft: `${Math.min(6, item.level) * 14 + 4}px` }}
                >
                  <span
                    className={`absolute -left-[9px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition ${active ? 'bg-accent' : 'bg-transparent group-hover/toc:bg-line-strong'}`}
                  />
                  {hasChildren ? (
                    <button
                      type="button"
                      aria-label={collapsed ? 'Развернуть раздел' : 'Свернуть раздел'}
                      aria-expanded={!collapsed}
                      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-line"
                      onClick={() =>
                        setCollapsedToc((value) => {
                          const next = new Set(value)
                          if (next.has(item.number)) next.delete(item.number)
                          else next.add(item.number)
                          return next
                        })
                      }
                    >
                      <ChevronDown
                        size={15}
                        className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
                      />
                    </button>
                  ) : (
                    <span className="mr-1 w-7 shrink-0" />
                  )}
                  <button
                    type="button"
                    aria-current={active ? 'location' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left"
                    onClick={() => openSection(item)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {sectionLabel(item, index)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {position}%
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  function captureSelection() {
    if (touchPaging || Date.now() - lastGesture.current < 350) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return
    const range = selection.getRangeAt(0)
    const startElement =
      range.startContainer.parentElement?.closest<HTMLElement>(
        '[data-reader-slice]',
      )
    const endElement = range.endContainer.parentElement?.closest<HTMLElement>(
      '[data-reader-slice]',
    )
    if (
      !startElement ||
      startElement !== endElement ||
      !readingArea.current?.contains(startElement)
    )
      return
    const prefix = range.cloneRange()
    prefix.selectNodeContents(startElement)
    prefix.setEnd(range.startContainer, range.startOffset)
    const startOffset =
      Number(startElement.dataset.base) + prefix.toString().length
    const exactText = selection.toString()
    if (!exactText.trim() || exactText.length > 10000) return
    setDraft({
      startOffset,
      endOffset: startOffset + exactText.length,
      exactText,
    })
  }

  useEffect(() => {
    if (preferences.mode === 'scroll' || !section.data) return
    const frame = pageFrame.current
    if (!frame) return
    const update = () =>
      setPageMetrics({ width: frame.clientWidth, height: frame.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    void document.fonts.ready.then(update)
    return () => observer.disconnect()
  }, [preferences.mode, section.data])

  useEffect(() => {
    if (
      preferences.mode === 'scroll' ||
      !section.data ||
      !pagedContent.current ||
      pageMetrics.width === 0
    )
      return
    const animation = requestAnimationFrame(() => {
      const content = pagedContent.current
      const frame = pageFrame.current
      if (!content || !frame) return
      const count = Math.max(
        1,
        Math.ceil(
          (content.scrollWidth + columnGap - 1) / (pageWidth + columnGap),
        ),
      )
      setPageCount(count)
      const local = Math.max(0, activeOffset - section.data.startOffset)
      const column = Math.min(count - 1, columnForLocalOffset(local))
      const group = Math.floor(column / pagesVisible) * pagesVisible
      setPageIndex(group)
      frame.scrollLeft = group * (pageWidth + columnGap)
    })
    return () => cancelAnimationFrame(animation)
    // Recalculate after typography, viewport, highlights, or images change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeOffset,
    columnGap,
    highlights.data,
    layoutEpoch,
    pageMetrics,
    pageWidth,
    pagesVisible,
    preferences.font,
    preferences.fontSize,
    preferences.lineHeight,
    section.data,
  ])

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  useEffect(() => {
    if (leftPanel !== 'toc') return
    const animation = requestAnimationFrame(() =>
      tocPanel.current
        ?.querySelector<HTMLElement>('[data-toc-active="true"]')
        ?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(animation)
  }, [leftPanel, mainTocOpen, extraTocOpen, sectionIndex])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.matches('input, textarea, select, [contenteditable="true"]') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        move(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        move(-1)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // Reader state is intentionally captured again after every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOffset, pageCount, pageIndex, preferences.mode, section.data])

  if (manifest.isPending) return <p role="status">Открываем книгу…</p>
  if (manifest.isError)
    return (
      <div role="alert" className="rounded-2xl bg-danger-soft p-5">
        <p>{manifest.error.message}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => void manifest.refetch()}
        >
          Повторить
        </Button>
      </div>
    )

  return (
    <div className="reader-shell min-h-screen">
      <header
        className={`sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur transition duration-300 md:px-5 ${chromeVisible ? '' : 'pointer-events-none -translate-y-full opacity-0'}`}
      >
        <Button
          asChild
          variant="outline"
          className="px-3"
          aria-label="В библиотеку"
        >
          <Link to="/library">
            <ArrowLeft size={18} />
          </Link>
        </Button>
        <Button
          variant="outline"
          className="px-3"
          aria-label="Оглавление"
          onClick={() => {
            if (leftPanel === 'toc') setLeftPanel(null)
            else {
              if (currentToc?.role === 'auxiliary') setExtraTocOpen(true)
              else setMainTocOpen(true)
              setLeftPanel('toc')
            }
          }}
        >
          <Menu size={18} />
        </Button>
        <div className="min-w-0 flex-1 px-2 text-center">
          <p className="truncate text-sm font-semibold">
            {manifest.data.title}
          </p>
          <p className="truncate text-xs text-muted">
            {currentToc?.title ?? currentMeta?.title} · {progress}%
          </p>
        </div>
        {manifest.data.format !== 'pdf' && (
          <Button
            variant="outline"
            className="px-3"
            aria-label="Добавить закладку"
            onClick={() => addBookmark.mutate()}
            disabled={addBookmark.isPending}
          >
            <BookmarkIcon size={18} />
          </Button>
        )}
        <Button
          variant="outline"
          className="hidden px-3 sm:inline-flex"
          aria-label={
            isFullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'
          }
          onClick={() =>
            void (isFullscreen
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen())
          }
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </Button>
        <Button
          variant="outline"
          className="px-3"
          aria-label="Настройки чтения"
          onClick={() => {
            setSettingsOpen((value) => !value)
            setNavigationOpen(false)
          }}
        >
          <Settings2 size={18} />
        </Button>
      </header>

      <div className="relative flex min-h-[calc(100vh-4rem)]">
        {leftPanel && (
          <aside className="absolute inset-y-0 left-0 z-20 w-[min(88vw,340px)] border-r border-line bg-surface p-4 shadow-xl md:relative md:shadow-none">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  className={`rounded-lg px-3 py-2 text-sm ${leftPanel === 'toc' ? 'bg-accent-soft text-accent' : 'text-muted'}`}
                  onClick={() => {
                    if (currentToc?.role === 'auxiliary')
                      setExtraTocOpen(true)
                    else setMainTocOpen(true)
                    setLeftPanel('toc')
                  }}
                >
                  Оглавление
                </button>
                <button
                  className={`rounded-lg px-3 py-2 text-sm ${leftPanel === 'marks' ? 'bg-accent-soft text-accent' : 'text-muted'}`}
                  onClick={() => setLeftPanel('marks')}
                >
                  Отметки
                </button>
              </div>
              <button
                aria-label="Закрыть панель"
                onClick={() => setLeftPanel(null)}
              >
                <X size={19} />
              </button>
            </div>
            {leftPanel === 'toc' ? (
              <nav
                ref={tocPanel}
                className="mt-4 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1"
                aria-label="Оглавление книги"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-subtle/60 p-3 text-left transition hover:border-accent-line hover:bg-accent-soft"
                  onClick={() => {
                    const first = tocEntries[0]
                    if (first) openSection(first)
                  }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <BookOpen size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {manifest.data.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {tocEntries.length}{' '}
                      {tocEntries.length === 1 ? 'раздел' : 'разделов'}
                    </span>
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-accent">
                    {progress}%
                  </span>
                </button>
                {tocGroup('Основной текст', mainToc, mainTocOpen, () =>
                  setMainTocOpen((value) => !value),
                )}
                {tocGroup(
                  'Дополнительные материалы',
                  extraToc,
                  extraTocOpen,
                  () => setExtraTocOpen((value) => !value),
                )}
              </nav>
            ) : (
              <div className="mt-4 max-h-[calc(100vh-9rem)] space-y-5 overflow-y-auto">
                <section>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <BookmarkIcon size={16} /> Закладки
                  </h2>
                  <div className="mt-2 space-y-2">
                    {bookmarks.data?.length ? (
                      bookmarks.data.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl bg-subtle p-3 text-sm"
                        >
                          <button
                            className="line-clamp-3 text-left"
                            onClick={() =>
                              openOffsetFromPanel(item.positionOffset)
                            }
                          >
                            {item.excerpt}
                          </button>
                          <button
                            className="mt-2 text-danger"
                            aria-label="Удалить закладку"
                            onClick={() => removeBookmark.mutate(item.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted">Закладок пока нет.</p>
                    )}
                  </div>
                </section>
                <section>
                  <h2 className="text-sm font-semibold">Выделения и заметки</h2>
                  <div className="mt-2 space-y-2">
                    {highlights.data?.length ? (
                      highlights.data.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl bg-subtle p-3 text-sm"
                        >
                          <button
                            className="line-clamp-3 text-left"
                            onClick={() => openOffsetFromPanel(item.startOffset)}
                          >
                            «{item.exactText}»
                          </button>
                          {item.note && (
                            <p className="mt-2 text-muted">{item.note}</p>
                          )}
                          <button
                            className="mt-2 text-danger"
                            aria-label="Удалить выделение"
                            onClick={() => removeHighlight.mutate(item.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted">Выделений пока нет.</p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </aside>
        )}

        <main
          ref={readerViewport}
          className={`relative h-[calc(100vh-4rem)] min-w-0 flex-1 ${themeClass} ${preferences.mode === 'scroll' ? 'overflow-y-auto' : 'overflow-hidden'}`}
          onPointerDown={(event) => {
            if (preferences.mode === 'scroll' || event.pointerType !== 'touch')
              return
            gesture.current = {
              x: event.clientX,
              y: event.clientY,
              pointerId: event.pointerId,
              moved: false,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
            setTouchPaging(true)
          }}
          onPointerMove={(event) => {
            if (gesture.current.pointerId !== event.pointerId) return
            if (
              Math.abs(event.clientX - gesture.current.x) > 10 ||
              Math.abs(event.clientY - gesture.current.y) > 10
            )
              gesture.current.moved = true
          }}
          onPointerUp={(event) => {
            if (gesture.current.pointerId !== event.pointerId) return
            const dx = event.clientX - gesture.current.x
            const dy = event.clientY - gesture.current.y
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.2) {
              lastGesture.current = Date.now()
              window.getSelection()?.removeAllRanges()
              move(dx < 0 ? 1 : -1)
            }
            gesture.current.pointerId = -1
            setTouchPaging(false)
          }}
          onPointerCancel={() => {
            gesture.current.pointerId = -1
            setTouchPaging(false)
          }}
          onClick={(event) => {
            if (
              Date.now() - lastGesture.current < 350 ||
              (event.target as HTMLElement).closest(
                'button, a, input, textarea, select, [role="dialog"]',
              ) ||
              !window.getSelection()?.isCollapsed
            )
              return
            setChromeVisible((value) => !value)
            setSettingsOpen(false)
            setNavigationOpen(false)
            setLeftPanel(null)
          }}
          onScroll={(event) => {
            if (preferences.mode !== 'scroll' || !scrollContent.data) return
            const viewport = event.currentTarget
            setActiveOffset(offsetFromScroll(viewport))
          }}
        >
          {settingsOpen && (
            <section
              role="dialog"
              aria-label="Настройки чтения"
              className="fixed right-3 top-20 z-40 max-h-[calc(100vh-5.75rem)] w-[min(92vw,360px)] overflow-y-auto overscroll-contain rounded-2xl border border-black/10 bg-surface p-5 text-foreground shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Оформление</h2>
                <button
                  aria-label="Закрыть настройки"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={19} />
                </button>
              </div>
              {manifest.data.format !== 'pdf' ? (
                <>
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['scroll', ScrollText, 'Прокрутка'],
                        ['page', List, 'Страница'],
                        ['spread', Columns2, 'Разворот'],
                      ] as const
                    ).map(([mode, Icon, label]) => (
                      <button
                        key={mode}
                        className={`rounded-xl border p-3 text-xs ${preferences.mode === mode ? 'border-accent-line bg-accent-soft text-accent' : 'border-line'}`}
                        onClick={() =>
                          setPreferences((value) => ({ ...value, mode }))
                        }
                      >
                        <Icon className="mx-auto mb-1" size={18} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted">
                    Листайте клавишами ← → или Page Up/Page Down. Нажатие по
                    центру страницы скрывает панели.
                  </p>
                  <label className="mt-5 block text-sm font-medium">
                    Размер шрифта
                  </label>
                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      variant="outline"
                      className="px-3"
                      aria-label="Уменьшить шрифт"
                      onClick={() =>
                        setPreferences((v) => ({
                          ...v,
                          fontSize: Math.max(14, v.fontSize - 1),
                        }))
                      }
                    >
                      <Minus size={16} />
                    </Button>
                    <span className="w-12 text-center text-sm">
                      {preferences.fontSize}px
                    </span>
                    <Button
                      variant="outline"
                      className="px-3"
                      aria-label="Увеличить шрифт"
                      onClick={() =>
                        setPreferences((v) => ({
                          ...v,
                          fontSize: Math.min(32, v.fontSize + 1),
                        }))
                      }
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                  <label className="mt-4 block text-sm font-medium">
                    Шрифт
                  </label>
                  <select
                    className="mt-2 w-full rounded-xl border border-line px-3 py-2"
                    value={preferences.font}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        font: event.target.value as ReaderFont,
                      }))
                    }
                  >
                    <option value="serif">С засечками</option>
                    <option value="sans">Без засечек</option>
                  </select>
                  <label className="mt-4 block text-sm font-medium">
                    Межстрочный интервал: {preferences.lineHeight.toFixed(1)}
                  </label>
                  <input
                    className="mt-2 w-full"
                    type="range"
                    min="1.2"
                    max="2"
                    step="0.1"
                    value={preferences.lineHeight}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        lineHeight: Number(event.target.value),
                      }))
                    }
                  />
                  <label className="mt-4 block text-sm font-medium">
                    Ширина текста: {preferences.width}px
                  </label>
                  <input
                    className="mt-2 w-full"
                    type="range"
                    min="480"
                    max="960"
                    step="40"
                    value={preferences.width}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        width: Number(event.target.value),
                      }))
                    }
                  />
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  Масштаб и страницы PDF настраиваются в панели просмотрщика.
                </p>
              )}
              <label className="mt-5 block text-sm font-medium">
                Тема страницы
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(
                  [
                    ['paper', 'Белая'],
                    ['sepia', 'Сепия'],
                    ['night', 'Тёмная'],
                  ] as const
                ).map(([theme, label]) => (
                  <button
                    key={theme}
                    className={`rounded-xl border px-2 py-3 text-sm ${preferences.theme === theme ? 'border-accent-line bg-accent-soft text-accent' : 'border-line'}`}
                    onClick={() =>
                      setPreferences((value) => ({ ...value, theme }))
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {manifest.data.format === 'pdf' ? (
            <iframe
              title={`Книга ${manifest.data.title}`}
              src={`/api/books/${encodeURIComponent(id)}/original`}
              className="h-[calc(100vh-4rem)] w-full border-0"
            />
          ) : (preferences.mode === 'scroll'
              ? scrollContent.isPending
              : section.isPending) ? (
            <p className="p-10 text-center" role="status">
              Загружаем текст…
            </p>
          ) : (preferences.mode === 'scroll'
              ? scrollContent.isError
              : section.isError) ? (
            <div className="p-10 text-center" role="alert">
              <p>
                {preferences.mode === 'scroll'
                  ? scrollContent.error?.message
                  : section.error?.message}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() =>
                  void (preferences.mode === 'scroll'
                    ? scrollContent.refetch()
                    : section.refetch())
                }
              >
                Повторить
              </Button>
            </div>
          ) : (
            <>
              <div
                ref={readingArea}
                onMouseUp={captureSelection}
                className={`mx-auto px-6 md:px-12 ${preferences.mode === 'scroll' ? `min-h-full py-12 ${themeClass}` : 'h-[calc(100vh-8rem)] py-8'}`}
                style={{
                  maxWidth:
                    preferences.mode === 'spread'
                      ? preferences.width * 2 + 150
                      : preferences.width + 100,
                }}
              >
                {preferences.mode === 'scroll' ? (
                  <div className="w-full">
                    {scrollContent.data?.map((item) => (
                      <article
                        key={item.number}
                        data-reader-slice
                        data-section-number={item.number}
                        data-base={item.startOffset}
                        data-end={item.endOffset}
                        className={`reader-page w-full whitespace-pre-wrap break-words [&+article]:mt-14 ${fontClass}`}
                        style={{
                          fontSize: preferences.fontSize,
                          lineHeight: preferences.lineHeight,
                        }}
                      >
                        {!!item.assets.length && (
                          <div className="mb-8 grid gap-5">
                            {item.assets.map((asset) => (
                              <img
                                key={asset.id}
                                src={`/api/books/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.id)}`}
                                alt="Иллюстрация из книги"
                                loading="lazy"
                                className="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain shadow-sm"
                              />
                            ))}
                          </div>
                        )}
                        <HighlightedText
                          text={item.content}
                          baseOffset={item.startOffset}
                          highlights={highlights.data ?? []}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <div
                    ref={pageFrame}
                    className="h-full w-full overflow-hidden overscroll-none"
                    style={{ touchAction: 'pan-y' }}
                  >
                    <article
                      ref={pagedContent}
                      data-reader-slice
                      data-base={section.data?.startOffset ?? 0}
                      className={`reader-page whitespace-pre-wrap break-words ${fontClass} ${touchPaging ? 'select-none' : ''}`}
                      style={{
                        width: pageMetrics.width || undefined,
                        height: pageMetrics.height || undefined,
                        columnWidth: pageWidth,
                        columnGap,
                        columnFill: 'auto',
                        fontSize: preferences.fontSize,
                        lineHeight: preferences.lineHeight,
                      }}
                    >
                      {!!section.data?.assets.length && (
                        <div className="mb-8 grid break-inside-avoid gap-5">
                          {section.data.assets.map((asset) => (
                            <img
                              key={asset.id}
                              src={`/api/books/${encodeURIComponent(id)}/assets/${encodeURIComponent(asset.id)}`}
                              alt="Иллюстрация из книги"
                              onLoad={() =>
                                setLayoutEpoch((value) => value + 1)
                              }
                              className="mx-auto max-h-[55vh] max-w-full rounded-lg object-contain shadow-sm"
                            />
                          ))}
                        </div>
                      )}
                      <HighlightedText
                        text={section.data?.content ?? ''}
                        baseOffset={section.data?.startOffset ?? 0}
                        highlights={highlights.data ?? []}
                      />
                    </article>
                  </div>
                )}
              </div>

              {draft && (
                <div className="fixed bottom-20 left-1/2 z-40 w-[min(92vw,430px)] -translate-x-1/2 rounded-2xl border border-line bg-surface p-4 text-foreground shadow-2xl">
                  <p className="line-clamp-2 text-sm">«{draft.exactText}»</p>
                  <div className="mt-3 flex gap-2">
                    {(['yellow', 'green', 'blue', 'pink'] as const).map(
                      (item) => (
                        <button
                          key={item}
                          aria-label={`Цвет ${item}`}
                          className={`h-7 w-7 rounded-full ${markColors[item].split(' ')[0]} ${color === item ? 'ring-2 ring-accent ring-offset-2' : ''}`}
                          onClick={() => setColor(item)}
                        />
                      ),
                    )}
                  </div>
                  <textarea
                    className="mt-3 min-h-16 w-full rounded-xl border border-line px-3 py-2 text-sm"
                    maxLength={2000}
                    placeholder="Заметка — необязательно"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setDraft(null)}>
                      Отмена
                    </Button>
                    <Button
                      onClick={() => addHighlight.mutate(draft)}
                      disabled={addHighlight.isPending}
                    >
                      Сохранить
                    </Button>
                  </div>
                </div>
              )}

              {navigationOpen && (
                <section
                  role="dialog"
                  aria-label="Переход по книге"
                  className="fixed bottom-20 left-1/2 z-40 max-h-[calc(100vh-6rem)] w-[min(92vw,420px)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-black/10 bg-surface p-5 text-foreground shadow-2xl"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="font-semibold">Переход по книге</h2>
                    <button
                      aria-label="Закрыть переход"
                      onClick={() => setNavigationOpen(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {preferences.mode !== 'scroll' && (
                    <label className="mt-4 flex items-center justify-between gap-4 text-sm">
                      Страница главы
                      <span className="flex items-center gap-2">
                        <input
                          className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-center"
                          type="number"
                          min={1}
                          max={pageCount}
                          value={pageIndex + 1}
                          onChange={(event) =>
                            showPage(Number(event.target.value) - 1, 'auto')
                          }
                        />
                        <span className="text-muted">из {pageCount}</span>
                      </span>
                    </label>
                  )}
                  <label className="mt-4 block text-sm">
                    Позиция в книге: {progress}%
                    <input
                      className="mt-2 w-full accent-teal-600"
                      type="range"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={(event) =>
                        jumpToPercent(Number(event.target.value))
                      }
                    />
                  </label>
                  <Button
                    variant="outline"
                    className="mt-4 w-full sm:hidden"
                    onClick={() =>
                      void (isFullscreen
                        ? document.exitFullscreen()
                        : document.documentElement.requestFullscreen())
                    }
                  >
                    {isFullscreen ? (
                      <Minimize2 size={17} />
                    ) : (
                      <Maximize2 size={17} />
                    )}
                    {isFullscreen ? 'Выйти из полного экрана' : 'Во весь экран'}
                  </Button>
                </section>
              )}

              <footer
                className={`sticky bottom-0 z-10 flex items-center gap-3 border-t border-black/10 bg-inherit px-4 py-3 transition duration-300 ${chromeVisible ? '' : 'pointer-events-none translate-y-full opacity-0'}`}
              >
                <Button
                  variant="outline"
                  className="px-3"
                  aria-label="Назад"
                  disabled={activeOffset <= 0}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <button
                  className="min-w-0 flex-1"
                  onClick={() => {
                    setNavigationOpen((value) => !value)
                    setSettingsOpen(false)
                  }}
                  title="Перейти к странице или проценту"
                >
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="mt-1 block text-xs opacity-70">
                    {preferences.mode === 'scroll'
                      ? `${progress}% · позиция ${activeOffset.toLocaleString('ru-RU')} из ${manifest.data.textLength.toLocaleString('ru-RU')}`
                      : `стр. ${pageIndex + 1}${pagesVisible === 2 && pageIndex + 2 <= pageCount ? `–${pageIndex + 2}` : ''} из ${pageCount} · ${progress}%`}
                  </span>
                </button>
                <Button
                  variant="outline"
                  className="px-3"
                  aria-label="Вперёд"
                  disabled={activeOffset >= manifest.data.textLength}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={18} />
                </Button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
