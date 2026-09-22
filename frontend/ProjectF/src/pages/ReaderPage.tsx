import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  BookText,
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Edit3,
  List,
  Highlighter,
  Keyboard,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Plus,
  Search,
  MessageCircleQuestion,
  ScrollText,
  Settings2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  booksApi,
  type BookSearchItem,
  type BookTocEntry,
  type Highlight,
  type ReadingProgress,
  type SectionContent,
  type SectionLink,
} from '../api/books'
import { ApiError } from '../api/client'
import type { BookChatSelection } from '../api/bookChat'
import { BookChatPanel } from '../components/BookChatPanel'
import { SummaryPanel } from '../components/SummaryPanel'
import { Button } from '../components/ui/button'
import { ModalDialog } from '../components/ui/modal-dialog'
import { NativeSelect } from '../components/ui/native-select'
import {
  ContinuousReader,
  type ScrollNavigation,
} from '../reader/ContinuousReader'
import { segmentReaderText } from '../reader/textSegments'
import {
  anchorFromOffset,
  offsetFromAnchor,
  type ProgressAnchor,
} from '../reader/textAnchors'
import {
  confirmedOffsetAfter,
  historyAnchorAtOffset,
  parseJumpTarget,
  parseSidebarTab,
  pushHistoryAnchor,
  SIDEBAR_TAB_KEY,
  type HistoryAnchor,
  type NavigationSource,
  type SidebarTab,
} from '../reader/navigationState'
import {
  readReaderPreferences,
  writeReaderPreferences,
  type ReaderFont,
} from '../reader/preferences'

type SelectionDraft = {
  startOffset: number
  endOffset: number
  exactText: string
  anchorX: number
  anchorY: number
  placeBelow: boolean
}
type LinkPreview = {
  link: SectionLink
  title: string
  excerpt: string
  loading: boolean
  anchorX: number
  anchorY: number
  placeBelow: boolean
  error?: string
}
type BookmarkDraft = {
  id?: string
  positionOffset: number
  excerpt: string
  label: string
}
type HighlightDraft = Pick<Highlight, 'id' | 'exactText' | 'color'> & {
  note: string
}
type DeleteDraft = {
  kind: 'bookmark' | 'highlight'
  id: string
  description: string
}
type MarkTypeFilter = 'all' | 'bookmarks' | 'highlights' | 'notes'
type MarkColorFilter = 'all' | Highlight['color']
type LocalProgress = ProgressAnchor & {
  confirmedOffset: number
  version: number
  elapsedSeconds: number
  savedAt: number
  pending: boolean
  sourceTab: string
  sessionId?: string
  sessionElapsedSeconds?: number
}

const SEARCH_PAGE_SIZE = 20
const READING_IDLE_MS = 60_000
const PdfReader = lazy(() =>
  import('../reader/PdfReader').then((module) => ({
    default: module.PdfReader,
  })),
)
const DocxReader = lazy(() =>
  import('../reader/DocxReader').then((module) => ({
    default: module.DocxReader,
  })),
)

function randomClientId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function progressKey(bookId: string) {
  return `reader-progress:${bookId}`
}

function readLocalProgress(bookId: string): LocalProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(progressKey(bookId)) ?? '')
    if (
      typeof value?.positionOffset !== 'number' ||
      typeof value?.sectionOffset !== 'number' ||
      typeof value?.version !== 'number' ||
      typeof value?.savedAt !== 'number'
    )
      return null
    return value as LocalProgress
  } catch {
    return null
  }
}

function writeLocalProgress(bookId: string, value: LocalProgress) {
  try {
    localStorage.setItem(progressKey(bookId), JSON.stringify(value))
  } catch {
    // Server synchronization still works when browser storage is unavailable.
  }
}

function readSidebarTab() {
  try {
    return parseSidebarTab(localStorage.getItem(SIDEBAR_TAB_KEY))
  } catch {
    return 'toc' as const
  }
}

function handleTabKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const current = tabs.indexOf(event.target as HTMLButtonElement)
  if (current < 0 || tabs.length === 0) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next].focus()
  tabs[next].click()
}

const markColors: Record<Highlight['color'], string> = {
  yellow: 'bg-amber-200/80 text-[#292722]',
  green: 'bg-emerald-200/80 text-[#292722]',
  blue: 'bg-sky-200/80 text-[#292722]',
  pink: 'bg-pink-200/80 text-[#292722]',
}

const markColorLabels: Record<Highlight['color'], string> = {
  yellow: 'Жёлтый',
  green: 'Зелёный',
  blue: 'Синий',
  pink: 'Розовый',
}

function formatMarkDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function selectionOffset(container: Node, offset: number) {
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement
  const slice = element?.closest<HTMLElement>('[data-reader-slice]')
  const textRoot =
    slice?.querySelector<HTMLElement>('[data-reader-text]') ?? slice
  if (!slice || !textRoot?.contains(container)) return null
  const base = Number(slice.dataset.base)
  if (!Number.isFinite(base)) return null
  try {
    const prefix = document.createRange()
    prefix.selectNodeContents(textRoot)
    prefix.setEnd(container, offset)
    return base + prefix.toString().length
  } catch {
    return null
  }
}

function HighlightedText({
  text,
  baseOffset,
  sectionStartOffset,
  highlights,
  searchMatches,
  activeSearchIndex,
  links,
  onNavigateLink,
}: {
  text: string
  baseOffset: number
  sectionStartOffset: number
  highlights: Highlight[]
  searchMatches: BookSearchItem[]
  activeSearchIndex: number | null
  links: SectionLink[]
  onNavigateLink: (link: SectionLink, anchor: DOMRect) => void
}) {
  return segmentReaderText({ text, baseOffset, sectionStartOffset, highlights, searchMatches, activeSearchIndex, links }).map((segment) => {
    const className = [
      segment.highlight ? markColors[segment.highlight.color] : '',
      segment.search === 'active' ? 'bg-orange-300/90 text-[#292722] ring-1 ring-orange-500/70' : segment.search === 'visible' ? 'bg-amber-200/80 text-[#292722]' : '',
      segment.highlight || segment.search ? 'rounded-sm' : '',
    ].filter(Boolean).join(' ')
    const content = <span className={className || undefined} title={segment.highlight?.note}>{segment.text}</span>
    return segment.link ? (
      <button key={`${segment.startOffset}-${segment.endOffset}`} type="button" className="inline rounded-sm text-inherit underline decoration-current/50 decoration-dotted underline-offset-4 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent" title={segment.link.kind === 'note' ? 'Показать примечание' : 'Предпросмотр внутренней ссылки'} onClick={(event) => onNavigateLink(segment.link!, event.currentTarget.getBoundingClientRect())}>{content}</button>
    ) : <span key={`${segment.startOffset}-${segment.endOffset}`}>{content}</span>
  })
}

function SearchExcerpt({ item }: { item: BookSearchItem }) {
  const start = Math.max(
    0,
    Math.min(item.excerpt.length, item.excerptMatchStart),
  )
  const end = Math.max(
    start,
    Math.min(item.excerpt.length, item.excerptMatchEnd),
  )
  return (
    <>
      {item.excerpt.slice(0, start)}
      <mark className="rounded-sm bg-amber-200/80 text-[#292722]">
        {item.excerpt.slice(start, end)}
      </mark>
      {item.excerpt.slice(end)}
    </>
  )
}

export function ReaderPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const assistantOpen = searchParams.get('panel') === 'book' || searchParams.get('summary') === '1'
  const assistantTab = searchParams.get('tab') === 'chat' ? 'chat' : 'summary'
  const setAssistant = (open: boolean, tab: 'summary' | 'chat' = assistantTab) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('summary')
      if (open) {
        next.set('panel', 'book')
        next.set('tab', tab)
      } else {
        next.delete('panel')
      }
      return next
    }, { replace: true })
  }
  const queryClient = useQueryClient()
  const [preferences, setPreferences] = useState(readReaderPreferences)
  const [activeOffset, setActiveOffset] = useState(0)
  const [leftPanel, setLeftPanel] = useState<SidebarTab | null>(null)
  const [lastSidebarTab, setLastSidebarTab] =
    useState<SidebarTab>(readSidebarTab)
  const [mainTocOpen, setMainTocOpen] = useState(true)
  const [extraTocOpen, setExtraTocOpen] = useState(false)
  const [collapsedToc, setCollapsedToc] = useState<Set<number>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsDialog = useRef<HTMLElement>(null)
  const [draft, setDraft] = useState<SelectionDraft | null>(null)
  const [selectionEditorOpen, setSelectionEditorOpen] = useState(false)
  const [selectionCopied, setSelectionCopied] = useState(false)
  const [chatSelection, setChatSelection] = useState<BookChatSelection | null>(null)
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null)
  const linkPreviewPopup = useRef<HTMLElement>(null)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [note, setNote] = useState('')
  const [color, setColor] = useState<Highlight['color']>('yellow')
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null)
  const [highlightDraft, setHighlightDraft] = useState<HighlightDraft | null>(
    null,
  )
  const [deleteDraft, setDeleteDraft] = useState<DeleteDraft | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const [markQuery, setMarkQuery] = useState('')
  const [markType, setMarkType] = useState<MarkTypeFilter>('all')
  const [markColor, setMarkColor] = useState<MarkColorFilter>('all')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [pageMetrics, setPageMetrics] = useState({ width: 0, height: 0 })
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const [scrollNavigation, setScrollNavigation] =
    useState<ScrollNavigation | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationDialog = useRef<HTMLElement>(null)
  const [jumpPercent, setJumpPercent] = useState('')
  const [jumpOffset, setJumpOffset] = useState('')
  const [jumpError, setJumpError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOffset, setSearchOffset] = useState(0)
  const [activeSearchMatch, setActiveSearchMatch] =
    useState<BookSearchItem | null>(null)
  const [navigationHistory, setNavigationHistory] = useState<HistoryAnchor[]>(
    [],
  )
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [touchPaging, setTouchPaging] = useState(false)
  const [progressSync, setProgressSync] = useState<
    'saved' | 'saving' | 'offline' | 'conflict'
  >('saved')
  const [initializedBookId, setInitializedBookId] = useState('')
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
  const lastReadingActivityAt = useRef(0)
  const readingSessionId = useRef(randomClientId())
  const readingSessionSeconds = useRef(0)
  const progressVersion = useRef(0)
  const confirmedOffsetRef = useRef(0)
  const pendingProgress = useRef<LocalProgress | null>(null)
  const progressSaving = useRef(false)
  const skipNextLocalSave = useRef(false)
  const scrollNavigationId = useRef(0)
  const tabId = useRef(randomClientId())
  const progressChannel = useRef<BroadcastChannel | null>(null)

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
  const savedProgress = useQuery({
    queryKey: ['book', id, 'progress'],
    queryFn: ({ signal }) => booksApi.progress(id, signal),
  })
  const searchResults = useQuery({
    queryKey: ['book', id, 'search', searchQuery, searchOffset],
    queryFn: ({ signal }) =>
      booksApi.search(id, searchQuery, searchOffset, SEARCH_PAGE_SIZE, signal),
    enabled: searchQuery.length >= 2,
    staleTime: 30_000,
  })

  const sections = manifest.data?.sections ?? []

  useEffect(() => {
    writeReaderPreferences(preferences)
  }, [preferences])
  useEffect(() => {
    if (!settingsOpen) return
    const opener = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => settingsDialog.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (opener?.isConnected) opener.focus()
    }
  }, [settingsOpen])
  useEffect(() => {
    if (!navigationOpen) return
    const opener = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => navigationDialog.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (opener?.isConnected) opener.focus()
    }
  }, [navigationOpen])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = searchInput.trim()
      setSearchQuery(nextQuery.length >= 2 ? nextQuery : '')
      setSearchOffset(0)
      setActiveSearchMatch(null)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  useEffect(() => {
    if (!manifest.data || !savedProgress.data || initialized.current === id)
      return
    initialized.current = id
    progressVersion.current = savedProgress.data.version
    const local = readLocalProgress(id)
    const serverTime = Date.parse(savedProgress.data.updatedAt) || 0
    const localWins =
      !!local &&
      (local.version > savedProgress.data.version ||
        (local.pending && local.savedAt > serverTime))
    const source = localWins ? local : savedProgress.data
    confirmedOffsetRef.current = localWins
      ? (local.confirmedOffset ?? savedProgress.data.confirmedOffset)
      : savedProgress.data.confirmedOffset
    const offset = offsetFromAnchor(
      {
        positionOffset: source.positionOffset,
        sectionNumber: source.sectionNumber ?? null,
        sectionOffset: source.sectionOffset ?? source.positionOffset,
      },
      manifest.data.sections,
      manifest.data.textLength,
    )
    pendingProgress.current = localWins ? local : null
    skipNextLocalSave.current = !localWins && offset !== activeOffsetRef.current
    setActiveOffset(offset)
    setScrollNavigation({
      id: ++scrollNavigationId.current,
      offset,
      behavior: 'auto',
      announce: true,
    })
    setProgressSync(
      localWins ? (navigator.onLine ? 'saving' : 'offline') : 'saved',
    )
    const now = Date.now()
    readingStartedAt.current = now
    lastReadingActivityAt.current = now
    readingSessionId.current = randomClientId()
    readingSessionSeconds.current = 0
    setInitializedBookId(id)
    if (localWins && navigator.onLine)
      window.setTimeout(() => void flushProgress(), 0)
    // Initialization deliberately chooses between server and offline state once per book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manifest.data, savedProgress.data])

  useEffect(() => {
    activeOffsetRef.current = activeOffset
  }, [activeOffset])

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
  const mainSections = sections.filter((item) => item.role === 'main')
  const currentMainIndex = Math.max(
    0,
    mainSections.findIndex((item) => item.number === currentMeta?.number),
  )
  const currentChapterMinutes = currentMeta
    ? Math.max(1, Math.ceil((currentMeta.endOffset - currentMeta.startOffset) / 1000))
    : 1
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
      manifest.data?.format !== 'docx' &&
      preferences.mode !== 'scroll',
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
  const pagesVisible =
    preferences.mode === 'spread' && pageMetrics.width >= 760 ? 2 : 1
  const columnGap = pagesVisible === 2 ? 48 : 64
  const pageWidth =
    pagesVisible === 2
      ? Math.max(1, (pageMetrics.width - columnGap) / 2)
      : Math.max(1, pageMetrics.width)

  const takeReadingSeconds = (finishingVisibleInterval = false) => {
    const now = Date.now()
    const startedAt = readingStartedAt.current || now
    readingStartedAt.current = now
    if (
      !finishingVisibleInterval &&
      (document.visibilityState === 'hidden' || !document.hasFocus())
    )
      return 0
    const activeUntil = Math.min(
      now,
      (lastReadingActivityAt.current || now) + READING_IDLE_MS,
    )
    return Math.max(0, Math.floor((activeUntil - startedAt) / 1000))
  }

  function queueProgress(positionOffset: number, elapsedSeconds = 0) {
    if (!manifest.data || initialized.current !== id) return
    const anchor = anchorFromOffset(
      positionOffset,
      manifest.data.sections,
      manifest.data.textLength,
    )
    const previous = pendingProgress.current
    readingSessionSeconds.current += elapsedSeconds
    const keepsPendingSession = !!previous?.elapsedSeconds
    const value: LocalProgress = {
      ...anchor,
      confirmedOffset: Math.max(
        confirmedOffsetRef.current,
        previous?.confirmedOffset ?? 0,
      ),
      version: progressVersion.current,
      elapsedSeconds: (previous?.elapsedSeconds ?? 0) + elapsedSeconds,
      savedAt: Date.now(),
      pending: true,
      sourceTab: tabId.current,
      sessionId: keepsPendingSession
        ? previous.sessionId
        : readingSessionId.current,
      sessionElapsedSeconds: keepsPendingSession
        ? (previous.sessionElapsedSeconds ?? previous.elapsedSeconds) +
          elapsedSeconds
        : readingSessionSeconds.current,
    }
    pendingProgress.current = value
    writeLocalProgress(id, value)
    setProgressSync(navigator.onLine ? 'saving' : 'offline')
  }

  function applyRemoteProgress(value: ReadingProgress) {
    if (!manifest.data) return
    progressVersion.current = value.version
    confirmedOffsetRef.current =
      value.confirmedOffset ?? confirmedOffsetRef.current
    const offset = offsetFromAnchor(
      {
        positionOffset: value.positionOffset,
        sectionNumber: value.sectionNumber ?? null,
        sectionOffset: value.sectionOffset ?? value.positionOffset,
      },
      manifest.data.sections,
      manifest.data.textLength,
    )
    skipNextLocalSave.current = offset !== activeOffsetRef.current
    setActiveOffset(offset)
    if (preferences.mode === 'scroll')
      navigateToOffset(offset, { preferSmooth: false, recordHistory: false })
  }

  async function flushProgress() {
    if (progressSaving.current || !pendingProgress.current || !manifest.data)
      return
    if (!navigator.onLine) {
      setProgressSync('offline')
      return
    }
    progressSaving.current = true
    setProgressSync('saving')
    const snapshot = pendingProgress.current
    let retryDelay = 250
    try {
      const result = await booksApi.saveProgress(id, {
        positionOffset: snapshot.positionOffset,
        confirmedOffset: snapshot.confirmedOffset,
        sectionNumber: snapshot.sectionNumber,
        sectionOffset: snapshot.sectionOffset,
        version: progressVersion.current,
        elapsedSeconds: snapshot.elapsedSeconds,
        sessionId: snapshot.sessionId,
        sessionElapsedSeconds: snapshot.sessionElapsedSeconds,
      })
      progressVersion.current = result.version
      queryClient.setQueryData(['book', id, 'progress'], result)
      const current = pendingProgress.current
      if (!current || current.savedAt <= snapshot.savedAt) {
        pendingProgress.current = null
        writeLocalProgress(id, {
          positionOffset: result.positionOffset,
          confirmedOffset: result.confirmedOffset,
          sectionNumber: result.sectionNumber ?? null,
          sectionOffset: result.sectionOffset,
          version: result.version,
          elapsedSeconds: 0,
          savedAt: Date.parse(result.updatedAt) || Date.now(),
          pending: false,
          sourceTab: tabId.current,
          sessionId: readingSessionId.current,
          sessionElapsedSeconds: readingSessionSeconds.current,
        })
        setProgressSync('saved')
      } else {
        current.version = result.version
        current.elapsedSeconds = Math.max(
          0,
          current.elapsedSeconds - snapshot.elapsedSeconds,
        )
        writeLocalProgress(id, current)
      }
      progressChannel.current?.postMessage(result)
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setProgressSync('conflict')
        try {
          const remote = await booksApi.progress(id)
          progressVersion.current = remote.version
          queryClient.setQueryData(['book', id, 'progress'], remote)
          const current = pendingProgress.current
          const remoteTime = Date.parse(remote.updatedAt) || 0
          if (current && current.savedAt > remoteTime) {
            current.version = remote.version
            writeLocalProgress(id, current)
          } else {
            pendingProgress.current = null
            applyRemoteProgress(remote)
            writeLocalProgress(id, {
              positionOffset: remote.positionOffset,
              confirmedOffset: remote.confirmedOffset,
              sectionNumber: remote.sectionNumber ?? null,
              sectionOffset: remote.sectionOffset,
              version: remote.version,
              elapsedSeconds: 0,
              savedAt: Date.parse(remote.updatedAt) || Date.now(),
              pending: false,
              sourceTab: tabId.current,
              sessionId: readingSessionId.current,
              sessionElapsedSeconds: readingSessionSeconds.current,
            })
            setProgressSync('saved')
          }
        } catch {
          setProgressSync(navigator.onLine ? 'conflict' : 'offline')
          retryDelay = 2_000
        }
      } else {
        setProgressSync(navigator.onLine ? 'saving' : 'offline')
        retryDelay = 5_000
      }
    } finally {
      progressSaving.current = false
      if (pendingProgress.current && navigator.onLine)
        window.setTimeout(() => void flushProgress(), retryDelay)
    }
  }

  useEffect(() => {
    if (!manifest.data || initialized.current !== id) return
    if (skipNextLocalSave.current) {
      skipNextLocalSave.current = false
      return
    }
    queueProgress(activeOffset)
    const timer = window.setTimeout(() => void flushProgress(), 800)
    return () => window.clearTimeout(timer)
    // Progress writes are debounced but the same anchor is stored locally immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOffset, id, manifest.data])

  useEffect(() => {
    if (!manifest.data || initialized.current !== id) return
    const persistReadingTime = () => {
      queueProgress(activeOffsetRef.current, takeReadingSeconds())
      void flushProgress()
    }
    const timer = window.setInterval(persistReadingTime, 30_000)
    const recordActivity = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return
      const now = Date.now()
      if (now - lastReadingActivityAt.current > READING_IDLE_MS)
        readingStartedAt.current = now
      lastReadingActivityAt.current = now
    }
    const pauseReading = () => {
      queueProgress(activeOffsetRef.current, takeReadingSeconds(true))
      void flushProgress()
    }
    const resumeReading = () => {
      const now = Date.now()
      readingStartedAt.current = now
      lastReadingActivityAt.current = now
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        pauseReading()
      } else {
        resumeReading()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', pauseReading)
    window.addEventListener('focus', resumeReading)
    for (const event of [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
    ] as const)
      document.addEventListener(event, recordActivity, { passive: true })
    document.addEventListener('scroll', recordActivity, {
      capture: true,
      passive: true,
    })
    window.addEventListener('pagehide', persistReadingTime)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', pauseReading)
      window.removeEventListener('focus', resumeReading)
      for (const event of [
        'pointerdown',
        'keydown',
        'wheel',
        'touchstart',
      ] as const)
        document.removeEventListener(event, recordActivity)
      document.removeEventListener('scroll', recordActivity, true)
      window.removeEventListener('pagehide', persistReadingTime)
      const seconds = takeReadingSeconds()
      queueProgress(activeOffsetRef.current, seconds)
    }
    // Progress mutation is intentionally sampled on a fixed interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manifest.data])

  useEffect(() => {
    const onOnline = () => void flushProgress()
    const onOffline = () => setProgressSync('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // Network recovery flushes the latest locally persisted anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manifest.data])

  useEffect(() => {
    if (!manifest.data) return
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(progressKey(id))
    progressChannel.current = channel
    const receive = (value: ReadingProgress | LocalProgress) => {
      if (value.version <= progressVersion.current) return
      progressVersion.current = value.version
      const current = pendingProgress.current
      const remoteTime =
        'updatedAt' in value
          ? Date.parse(value.updatedAt) || Date.now()
          : value.savedAt
      if (current && current.savedAt > remoteTime) {
        current.version = value.version
        writeLocalProgress(id, current)
        void flushProgress()
        return
      }
      pendingProgress.current = null
      applyRemoteProgress(value as ReadingProgress)
      setProgressSync('saved')
    }
    if (channel) channel.onmessage = (event) => receive(event.data)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== progressKey(id) || !event.newValue) return
      try {
        const value = JSON.parse(event.newValue) as LocalProgress
        if (value.sourceTab !== tabId.current) receive(value)
      } catch {
        // Ignore a partial or outdated local storage entry.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      channel?.close()
      if (progressChannel.current === channel) progressChannel.current = null
      window.removeEventListener('storage', onStorage)
    }
    // Cross-tab listeners are recreated for each opened book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, manifest.data])

  function openBookmarkCreator() {
    const activeContent =
      preferences.mode === 'scroll'
        ? queryClient.getQueryData<SectionContent>([
            'book',
            id,
            'section',
            currentMeta?.number,
          ])
        : section.data
    const content = activeContent?.content ?? ''
    const start = Math.max(0, activeOffset - (currentMeta?.startOffset ?? 0))
    const excerpt =
      content
        .slice(start, start + 180)
        .replace(/\s+/g, ' ')
        .trim() ||
      manifest.data?.title ||
      'Закладка'
    setBookmarkDraft({
      positionOffset: activeOffset,
      excerpt,
      label: currentToc?.title ?? currentMeta?.title ?? '',
    })
  }

  const saveBookmark = useMutation({
    mutationFn: (value: BookmarkDraft) =>
      value.id
        ? booksApi.updateBookmark(id, value.id, value.label.trim() || undefined)
        : booksApi.addBookmark(id, {
            positionOffset: value.positionOffset,
            excerpt: value.excerpt,
            label: value.label.trim() || undefined,
          }),
    onSuccess: () => {
      setBookmarkDraft(null)
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'bookmarks'],
      })
    },
  })
  const removeBookmark = useMutation({
    mutationFn: (bookmarkId: string) => booksApi.removeBookmark(id, bookmarkId),
    onSuccess: () => {
      setDeleteDraft(null)
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'bookmarks'],
      })
    },
  })
  const addHighlight = useMutation({
    mutationFn: (selection: SelectionDraft) =>
      booksApi.addHighlight(id, {
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        exactText: selection.exactText,
        color,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setDraft(null)
      setSelectionEditorOpen(false)
      setNote('')
      window.getSelection()?.removeAllRanges()
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'highlights'],
      })
    },
  })
  const saveHighlight = useMutation({
    mutationFn: (value: HighlightDraft) =>
      booksApi.updateHighlight(id, value.id, {
        color: value.color,
        note: value.note.trim() || undefined,
      }),
    onSuccess: () => {
      setHighlightDraft(null)
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'highlights'],
      })
    },
  })
  const removeHighlight = useMutation({
    mutationFn: (highlightId: string) =>
      booksApi.removeHighlight(id, highlightId),
    onSuccess: () => {
      setDeleteDraft(null)
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'highlights'],
      })
    },
  })

  const normalizedMarkQuery = markQuery.trim().toLocaleLowerCase('ru-RU')
  const filteredBookmarks = (bookmarks.data ?? []).filter((item) => {
    if (markType !== 'all' && markType !== 'bookmarks') return false
    if (markColor !== 'all') return false
    return (
      !normalizedMarkQuery ||
      `${item.label ?? ''} ${item.excerpt}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedMarkQuery)
    )
  })
  const filteredHighlights = (highlights.data ?? []).filter((item) => {
    if (markType === 'bookmarks') return false
    if (markType === 'notes' && !item.note) return false
    if (markColor !== 'all' && item.color !== markColor) return false
    return (
      !normalizedMarkQuery ||
      `${item.exactText} ${item.note ?? ''}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedMarkQuery)
    )
  })

  const progress = manifest.data?.textLength
    ? Math.min(100, Math.round((activeOffset / manifest.data.textLength) * 100))
    : 0

  const themeClass = {
    paper: 'bg-[#fbfaf7] text-[#292722]',
    sepia: 'bg-[#f3e6ca] text-[#483b2b]',
    night: 'bg-[#14191f] text-[#d9d6cf]',
  }[preferences.theme]
  const fontClass = `reader-font-${preferences.font}`

  const updateReaderOffset = useCallback(
    (requestedOffset: number, source: 'user' | 'programmatic') => {
      if (!manifest.data) return
      const offset = Math.max(
        0,
        Math.min(manifest.data.textLength, requestedOffset),
      )
      confirmedOffsetRef.current = confirmedOffsetAfter(
        confirmedOffsetRef.current,
        offset,
        source,
      )
      activeOffsetRef.current = offset
      setActiveOffset(offset)
      return offset
    },
    [manifest.data],
  )

  const handleNavigationSettled = useCallback((navigationId: number) => {
    setScrollNavigation((current) =>
      current?.id === navigationId ? null : current,
    )
  }, [])

  function navigateToOffset(
    requestedOffset: number,
    options: {
      preferSmooth?: boolean
      source?: NavigationSource
      label?: string
      recordHistory?: boolean
    } = {},
  ) {
    if (!manifest.data) return
    const previousOffset = activeOffsetRef.current
    const offset = updateReaderOffset(requestedOffset, 'programmatic')
    if (offset === undefined) return
    if (options.source && options.recordHistory !== false) {
      const anchor = historyAnchorAtOffset(
        previousOffset,
        manifest.data.sections,
        manifest.data.textLength,
        options.source,
        options.label,
      )
      setNavigationHistory((current) => pushHistoryAnchor(current, anchor))
    }
    if (preferences.mode !== 'scroll') return
    const nearby = Math.abs(offset - previousOffset) < 80_000
    setScrollNavigation({
      id: ++scrollNavigationId.current,
      offset,
      behavior: options.preferSmooth !== false && nearby ? 'smooth' : 'auto',
      announce: !nearby,
    })
  }

  function backToPreviousPlace() {
    const anchor = navigationHistory.at(-1)
    if (!anchor || !manifest.data) return
    setNavigationHistory((current) => current.slice(0, -1))
    navigateToOffset(
      offsetFromAnchor(
        anchor,
        manifest.data.sections,
        manifest.data.textLength,
      ),
      { preferSmooth: false, recordHistory: false },
    )
  }

  function selectSearchMatch(item: BookSearchItem) {
    setActiveSearchMatch(item)
    navigateToOffset(item.positionOffset, {
      source: 'search',
      label: `Поиск: ${searchQuery}`,
    })
  }

  async function moveSearch(direction: -1 | 1) {
    if (!searchResults.data || !searchQuery) return
    const currentIndex =
      activeSearchMatch?.index ?? searchResults.data.items[0]?.index ?? 0
    const targetIndex = currentIndex + direction
    if (targetIndex < 0 || targetIndex >= searchResults.data.total) return
    const currentMatch = searchResults.data.items.find(
      (item) => item.index === targetIndex,
    )
    if (currentMatch) {
      selectSearchMatch(currentMatch)
      return
    }
    const nextOffset =
      Math.floor(targetIndex / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE
    try {
      const page = await queryClient.fetchQuery({
        queryKey: ['book', id, 'search', searchQuery, nextOffset],
        queryFn: ({ signal }) =>
          booksApi.search(
            id,
            searchQuery,
            nextOffset,
            SEARCH_PAGE_SIZE,
            signal,
          ),
        staleTime: 30_000,
      })
      setSearchOffset(nextOffset)
      const match = page.items.find((item) => item.index === targetIndex)
      if (match) selectSearchMatch(match)
    } catch {
      setSearchOffset(nextOffset)
    }
  }

  function navigateSectionLink(link: SectionLink, anchor: DOMRect) {
    if (!manifest.data) return
    const sectionMeta = manifest.data.sections.find(
      (item) => item.number === link.targetSectionNumber,
    )
    const target =
      link.targetPositionOffset ??
      (sectionMeta && link.targetSectionOffset !== null
        ? sectionMeta.startOffset + link.targetSectionOffset
        : null)
    if (target === null) return
    const title = sectionMeta?.title ?? (link.kind === 'note' ? 'Примечание' : 'Ссылка')
    const halfWidth = Math.min(220, window.innerWidth * 0.46)
    const placeBelow = anchor.top < window.innerHeight * 0.48
    setLinkPreview({
      link,
      title,
      excerpt: '',
      loading: true,
      anchorX: Math.min(
        window.innerWidth - halfWidth,
        Math.max(halfWidth, anchor.left + anchor.width / 2),
      ),
      anchorY: placeBelow ? anchor.bottom + 8 : anchor.top - 8,
      placeBelow,
    })
    void queryClient.fetchQuery({
      queryKey: ['book', id, 'section', link.targetSectionNumber],
      queryFn: ({ signal }) => booksApi.section(id, link.targetSectionNumber, signal),
      staleTime: Infinity,
    }).then((content) => {
      const local = Math.max(0, Math.min(content.content.length, link.targetSectionOffset))
      const start = Math.max(0, local - 180)
      const end = Math.min(content.content.length, local + 520)
      setLinkPreview((current) => current?.link === link ? {
        ...current,
        title,
        excerpt: content.content.slice(start, end).trim() || 'У примечания нет отдельного текста.',
        loading: false,
      } : current)
    }).catch(() => setLinkPreview((current) => current?.link === link ? {
      ...current,
      loading: false,
      error: 'Не удалось загрузить фрагмент.',
    } : current))
  }

  function followPreviewLink() {
    if (!linkPreview || !manifest.data) return
    const sectionMeta = manifest.data.sections.find((item) => item.number === linkPreview.link.targetSectionNumber)
    const target = linkPreview.link.targetPositionOffset ??
      (sectionMeta ? sectionMeta.startOffset + linkPreview.link.targetSectionOffset : null)
    if (target === null) return
    const kind = linkPreview.link.kind
    setLinkPreview(null)
    navigateToOffset(target, {
      source: 'internal',
      label: kind === 'note' ? 'Переход к примечанию' : 'Внутренняя ссылка',
    })
  }

  useEffect(() => {
    if (!linkPreview) return
    const closeOutside = (event: PointerEvent) => {
      if (!linkPreviewPopup.current?.contains(event.target as Node))
        setLinkPreview(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [linkPreview])

  function moveChapter(direction: -1 | 1) {
    const target = mainSections[currentMainIndex + direction]
    if (target) navigateToOffset(target.startOffset, { source: 'toc', label: target.title })
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
    updateReaderOffset(
      Math.min(
        currentMeta?.endOffset ?? manifest.data?.textLength ?? 0,
        (currentMeta?.startOffset ?? 0) + localOffsetForColumn(page),
      ),
      'user',
    )
  }

  function move(direction: -1 | 1) {
    if (!currentMeta || !manifest.data) return
    if (manifest.data.format === 'docx') {
      const viewport = readerViewport.current
      if (!viewport) return
      viewport.scrollBy({
        top: direction * (viewport.clientHeight * 0.85),
        behavior: 'smooth',
      })
      return
    }
    if (manifest.data.format === 'pdf' && preferences.mode !== 'scroll') {
      window.dispatchEvent(
        new CustomEvent('projectf:pdf-page', { detail: direction }),
      )
      return
    }
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
      updateReaderOffset(sections[sectionIndex + 1].startOffset, 'user')
      setPageIndex(0)
    } else if (direction < 0 && sectionIndex > 0) {
      const previous = sections[sectionIndex - 1]
      updateReaderOffset(
        Math.max(previous.startOffset, previous.endOffset - 1),
        'user',
      )
    }
  }

  function submitJump(kind: 'percent' | 'offset', value: string) {
    if (!manifest.data) return
    const result = parseJumpTarget(kind, value, manifest.data.textLength)
    if (result.error || result.offset === undefined) {
      setJumpError(result.error ?? 'Не удалось определить позицию.')
      return
    }
    setJumpError('')
    navigateToOffset(result.offset, {
      source: kind,
      label: kind === 'percent' ? `${value}%` : `Позиция ${value}`,
    })
    setNavigationOpen(false)
  }

  function openOffsetFromPanel(
    offset: number,
    source: NavigationSource,
    label?: string,
  ) {
    setLeftPanel(null)
    navigateToOffset(offset, { source, label })
  }

  function openSection(item: BookTocEntry) {
    openOffsetFromPanel(item.positionOffset, 'toc', item.title)
  }

  function sectionLabel(item: BookTocEntry, index: number) {
    const title = item.title?.replace(/\s+/g, ' ').trim()
    return title || `Глава ${index + 1}`
  }

  function selectSidebarTab(tab: SidebarTab) {
    setLastSidebarTab(tab)
    setLeftPanel(tab)
    try {
      localStorage.setItem(SIDEBAR_TAB_KEY, tab)
    } catch {
      // The tab still works when browser storage is unavailable.
    }
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
                  ? Math.round(
                      (item.positionOffset / manifest.data.textLength) * 100,
                    )
                  : 0
                return (
                  <div
                    key={item.number}
                    data-toc-active={active || undefined}
                    title={sectionLabel(item, index)}
                    className={`group/toc relative flex w-full items-center rounded-lg py-0.5 pr-1 text-sm transition ${active ? 'bg-accent-soft font-medium text-accent' : 'text-secondary hover:bg-subtle hover:text-foreground'}`}
                    style={{
                      paddingLeft: `${Math.min(6, item.level) * 14 + 4}px`,
                    }}
                  >
                    <span
                      className={`absolute -left-[9px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full transition ${active ? 'bg-accent' : 'bg-transparent group-hover/toc:bg-line-strong'}`}
                    />
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={
                          collapsed ? 'Развернуть раздел' : 'Свернуть раздел'
                        }
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
    const startOffset = selectionOffset(range.startContainer, range.startOffset)
    const endOffset = selectionOffset(range.endContainer, range.endOffset)
    const exactText = selection.toString()
    if (startOffset === null || endOffset === null || !exactText.trim()) return
    if (endOffset <= startOffset || endOffset - startOffset > 10000) {
      setSelectionError('Выделите не более 10 000 символов.')
      return
    }
    const duplicate = (highlights.data ?? []).some(
      (item) =>
        item.startOffset === startOffset && item.endOffset === endOffset,
    )
    if (duplicate) {
      selection.removeAllRanges()
      setDraft(null)
      setSelectionError('Этот фрагмент уже выделен.')
      return
    }
    setSelectionError('')
    addHighlight.reset()
    setSelectionEditorOpen(false)
    setSelectionCopied(false)
    const rect = range.getBoundingClientRect()
    const halfWidth = Math.min(270, window.innerWidth * 0.47)
    setDraft({
      startOffset,
      endOffset,
      exactText,
      anchorX: Math.min(window.innerWidth - halfWidth, Math.max(halfWidth, rect.left + rect.width / 2)),
      anchorY: rect.top > 220 ? rect.top - 10 : rect.bottom + 10,
      placeBelow: rect.top <= 220,
    })
  }

  function askAboutSelection(selection: SelectionDraft) {
    setChatSelection(selection)
    setDraft(null)
    window.getSelection()?.removeAllRanges()
    setSettingsOpen(false)
    setNavigationOpen(false)
    setAssistant(true, 'chat')
  }

  async function copySelection(selection: SelectionDraft) {
    try {
      await navigator.clipboard.writeText(selection.exactText)
      setSelectionCopied(true)
      window.setTimeout(() => setSelectionCopied(false), 1500)
    } catch {
      setSelectionError('Не удалось скопировать выделенный текст.')
    }
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
      const local = Math.max(0, activeOffset - (currentMeta?.startOffset ?? 0))
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
    preferences.pageMargin,
    preferences.textAlign,
    section.data,
    currentMeta,
  ])

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setLayoutEpoch((value) => value + 1)
    })
    return () => {
      cancelled = true
    }
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
      if (event.key === 'Escape') {
        const hadOverlay =
          leftPanel !== null ||
          settingsOpen ||
          navigationOpen ||
          assistantOpen ||
          shortcutHelpOpen ||
          linkPreview !== null ||
          draft !== null ||
          bookmarkDraft !== null ||
          highlightDraft !== null ||
          deleteDraft !== null
        setLeftPanel(null)
        setSettingsOpen(false)
        setNavigationOpen(false)
        setDraft(null)
        setBookmarkDraft(null)
        setHighlightDraft(null)
        setDeleteDraft(null)
        setShortcutHelpOpen(false)
        setLinkPreview(null)
        window.getSelection()?.removeAllRanges()
        if (hadOverlay) event.preventDefault()
        else if (!chromeVisible) {
          setChromeVisible(true)
          event.preventDefault()
        }
        return
      }
      if (event.key === 'Tab' && !chromeVisible) {
        event.preventDefault()
        setChromeVisible(true)
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.reader-shell header a')?.focus())
        return
      }
      const target = event.target as HTMLElement | null
      if (
        assistantOpen ||
        leftPanel !== null ||
        settingsOpen ||
        navigationOpen ||
        target?.closest('button, a, input, textarea, select, [role="dialog"], [role="tab"], [contenteditable="true"]') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const key = event.key.toLocaleLowerCase('ru-RU')
      if (event.key === '/') {
        event.preventDefault()
        setChromeVisible(true)
        selectSidebarTab('search')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Поиск по книге"]')?.focus())
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setShortcutHelpOpen(true)
        return
      }
      if (key === 't' || key === 'е') {
        event.preventDefault()
        setChromeVisible(true)
        selectSidebarTab('toc')
        return
      }
      if (key === 'b' || key === 'и') {
        event.preventDefault()
        openBookmarkCreator()
        return
      }
      if (key === 'a' || key === 'ф') {
        event.preventDefault()
        setAssistant(true, 'chat')
        return
      }
      if (key === 'f' || key === 'а') {
        event.preventDefault()
        void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
        return
      }
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
  }, [
    activeOffset,
    bookmarkDraft,
    deleteDraft,
    draft,
    highlightDraft,
    leftPanel,
    navigationOpen,
    pageCount,
    pageIndex,
    preferences.mode,
    section.data,
    settingsOpen,
    assistantOpen,
    shortcutHelpOpen,
    linkPreview,
    chromeVisible,
  ])

  if (manifest.isPending || savedProgress.isPending)
    return <p role="status">Открываем книгу…</p>
  if (manifest.isError || savedProgress.isError)
    return (
      <div role="alert" className="rounded-2xl bg-danger-soft p-5">
        <p>{manifest.error?.message ?? savedProgress.error?.message}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => {
            void manifest.refetch()
            void savedProgress.refetch()
          }}
        >
          Повторить
        </Button>
      </div>
    )
  if (initializedBookId !== id)
    return <p role="status">Восстанавливаем место чтения…</p>

  return (
    <div
      className="reader-shell min-h-screen bg-page text-foreground"
      data-reader-theme={preferences.theme}
    >
      {chromeVisible && (
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-1 border-b border-line bg-page/95 px-2 backdrop-blur sm:gap-2 sm:px-3 md:px-5">
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
          aria-label="Боковая панель"
          aria-expanded={leftPanel !== null}
          aria-controls={leftPanel ? 'reader-sidebar-panel' : undefined}
          onClick={() => {
            if (leftPanel) setLeftPanel(null)
            else {
              if (lastSidebarTab === 'toc') {
                if (currentToc?.role === 'auxiliary') setExtraTocOpen(true)
                else setMainTocOpen(true)
              }
              setLeftPanel(lastSidebarTab)
            }
          }}
        >
          <Menu size={18} />
        </Button>
        <Button
          variant="outline"
          className="hidden px-3 sm:inline-flex"
          aria-label="Назад к предыдущему месту"
          title="Назад к предыдущему месту"
          disabled={!navigationHistory.length}
          onClick={backToPreviousPlace}
        >
          <Undo2 size={18} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-center sm:gap-2 sm:px-2" aria-label="Навигация по главам">
          <button type="button" className="hidden rounded-lg p-2 text-muted hover:bg-subtle disabled:opacity-30 md:inline-grid" aria-label="Предыдущая глава" disabled={currentMainIndex <= 0} onClick={() => moveChapter(-1)}><ChevronLeft size={17} /></button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{currentToc?.title ?? currentMeta?.title ?? manifest.data.title}</p>
            <p className="truncate text-xs text-muted">{manifest.data.title} · около {currentChapterMinutes} мин · {progress}%</p>
          </div>
          <button type="button" className="hidden rounded-lg p-2 text-muted hover:bg-subtle disabled:opacity-30 md:inline-grid" aria-label="Следующая глава" disabled={currentMainIndex >= mainSections.length - 1} onClick={() => moveChapter(1)}><ChevronRight size={17} /></button>
        </div>
        {manifest.data.format !== 'pdf' && (
          <Button
            variant="outline"
            className="px-3"
            aria-label="Добавить закладку"
            onClick={openBookmarkCreator}
            disabled={saveBookmark.isPending}
          >
            <BookmarkIcon size={18} />
          </Button>
        )}
        <Button
          variant="outline"
          className="px-3"
          aria-label="Помощник по книге"
          title="Изложение и чат по книге"
          aria-expanded={assistantOpen}
          onClick={() => {
            setSettingsOpen(false)
            setNavigationOpen(false)
            setAssistant(!assistantOpen)
          }}
        >
          <BookText size={18} />
        </Button>
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
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? 'reader-settings' : undefined}
          onClick={() => {
            setSettingsOpen((value) => !value)
            setNavigationOpen(false)
          }}
        >
          <Settings2 size={18} />
        </Button>
        </header>
      )}

      {assistantOpen && (
        <ModalDialog
          labelledBy="reader-assistant-title"
          onClose={() => setAssistant(false)}
          placement="right"
          className={`project-scrollbar h-dvh w-full max-w-[560px] overscroll-contain border-l border-line bg-page p-4 text-foreground shadow-2xl sm:p-6 ${assistantTab === 'chat' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Книга</p>
              <h2 id="reader-assistant-title" className="mt-1 truncate text-lg font-semibold">{manifest.data.title}</h2>
            </div>
            <Button variant="outline" className="shrink-0 px-3" aria-label="Закрыть помощника" onClick={() => setAssistant(false)}>
              <X size={18} />
            </Button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2" role="tablist" aria-label="Помощник по книге" onKeyDown={handleTabKeys}>
            <button id="reader-assistant-summary-tab" type="button" role="tab" tabIndex={assistantTab === 'summary' ? 0 : -1} aria-controls="reader-assistant-panel" aria-selected={assistantTab === 'summary'} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${assistantTab === 'summary' ? 'bg-accent-soft text-accent' : 'bg-surface text-muted'}`} onClick={() => setAssistant(true, 'summary')}>Изложение</button>
            <button id="reader-assistant-chat-tab" type="button" role="tab" tabIndex={assistantTab === 'chat' ? 0 : -1} aria-controls="reader-assistant-panel" aria-selected={assistantTab === 'chat'} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${assistantTab === 'chat' ? 'bg-accent-soft text-accent' : 'bg-surface text-muted'}`} onClick={() => setAssistant(true, 'chat')}>Чат</button>
          </div>
          <div id="reader-assistant-panel" role="tabpanel" aria-labelledby={`reader-assistant-${assistantTab}-tab`} className={assistantTab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          {assistantTab === 'summary' ? (
            <SummaryPanel key={id} id={id} chapters={manifest.data.sections} />
          ) : (
            <BookChatPanel key={`${id}:${chatSelection ? `${chatSelection.startOffset}:${chatSelection.endOffset}` : 'chat'}`} bookId={id} initialSelection={chatSelection} onSelectionConsumed={() => setChatSelection(null)} onOpenSource={(offset, label) => {
              setAssistant(false)
              navigateToOffset(offset, { source: 'internal', label: `Чат: ${label}`, preferSmooth: false })
            }} />
          )}
          </div>
        </ModalDialog>
      )}

      <div className={`relative flex ${chromeVisible ? 'min-h-[calc(100dvh-4rem)]' : 'min-h-dvh'}`}>
        {leftPanel && (
          <aside className="absolute inset-y-0 left-0 z-20 w-[min(88vw,340px)] border-r border-line bg-surface p-4 shadow-xl md:relative md:shadow-none">
            <div className="flex items-start justify-between gap-2">
              <div className="grid flex-1 grid-cols-3 gap-1" role="tablist" aria-label="Боковая панель книги" onKeyDown={handleTabKeys}>
                <button
                  id="reader-sidebar-toc-tab"
                  role="tab"
                  tabIndex={leftPanel === 'toc' ? 0 : -1}
                  aria-controls="reader-sidebar-panel"
                  aria-selected={leftPanel === 'toc'}
                  className={`rounded-lg px-2 py-2 text-xs sm:text-sm ${leftPanel === 'toc' ? 'bg-accent-soft text-accent' : 'text-muted'}`}
                  onClick={() => {
                    if (currentToc?.role === 'auxiliary') setExtraTocOpen(true)
                    else setMainTocOpen(true)
                    selectSidebarTab('toc')
                  }}
                >
                  Оглавление
                </button>
                <button
                  id="reader-sidebar-marks-tab"
                  role="tab"
                  tabIndex={leftPanel === 'marks' ? 0 : -1}
                  aria-controls="reader-sidebar-panel"
                  aria-selected={leftPanel === 'marks'}
                  className={`rounded-lg px-2 py-2 text-xs sm:text-sm ${leftPanel === 'marks' ? 'bg-accent-soft text-accent' : 'text-muted'}`}
                  onClick={() => selectSidebarTab('marks')}
                >
                  Отметки
                </button>
                <button
                  id="reader-sidebar-search-tab"
                  role="tab"
                  tabIndex={leftPanel === 'search' ? 0 : -1}
                  aria-controls="reader-sidebar-panel"
                  aria-selected={leftPanel === 'search'}
                  className={`rounded-lg px-2 py-2 text-xs sm:text-sm ${leftPanel === 'search' ? 'bg-accent-soft text-accent' : 'text-muted'}`}
                  onClick={() => selectSidebarTab('search')}
                >
                  Поиск
                </button>
              </div>
              <button
                aria-label="Закрыть панель"
                onClick={() => setLeftPanel(null)}
              >
                <X size={19} />
              </button>
            </div>
            <div id="reader-sidebar-panel" role="tabpanel" aria-labelledby={`reader-sidebar-${leftPanel}-tab`}>
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
            ) : leftPanel === 'marks' ? (
              <div className="mt-4 max-h-[calc(100vh-9rem)] space-y-5 overflow-y-auto">
                <section className="space-y-2" aria-label="Фильтры отметок">
                  <label className="relative block">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                      size={16}
                    />
                    <input
                      type="search"
                      className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm"
                      value={markQuery}
                      onChange={(event) => setMarkQuery(event.target.value)}
                      placeholder="Поиск по отметкам"
                      aria-label="Поиск по закладкам и заметкам"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NativeSelect
                      className="h-10 w-full rounded-xl border border-line bg-surface px-3 pr-9 text-sm"
                      value={markType}
                      onChange={(event) =>
                        setMarkType(event.target.value as MarkTypeFilter)
                      }
                      aria-label="Тип отметки"
                    >
                      <option value="all">Все типы</option>
                      <option value="bookmarks">Закладки</option>
                      <option value="highlights">Выделения</option>
                      <option value="notes">С заметками</option>
                    </NativeSelect>
                    <NativeSelect
                      className="h-10 w-full rounded-xl border border-line bg-surface px-3 pr-9 text-sm"
                      value={markColor}
                      onChange={(event) =>
                        setMarkColor(event.target.value as MarkColorFilter)
                      }
                      disabled={markType === 'bookmarks'}
                      aria-label="Цвет выделения"
                    >
                      <option value="all">Все цвета</option>
                      {Object.entries(markColorLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button asChild variant="outline" className="h-10 w-full">
                    <a href={booksApi.annotationsExportUrl(id)} download>
                      <Download size={16} /> Экспортировать Markdown
                    </a>
                  </Button>
                </section>
                {(markType === 'all' || markType === 'bookmarks') && (
                  <section>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <BookmarkIcon size={16} /> Закладки
                    </h2>
                    <div className="mt-2 space-y-2">
                      {filteredBookmarks.length ? (
                        filteredBookmarks.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-xl bg-subtle p-3 text-sm"
                          >
                            <p className="font-semibold">
                              {item.label || 'Закладка'}
                            </p>
                            <button
                              className="mt-1 line-clamp-3 text-left text-muted hover:text-foreground"
                              onClick={() =>
                                openOffsetFromPanel(
                                  item.positionOffset,
                                  'bookmark',
                                  item.label || 'Закладка',
                                )
                              }
                            >
                              {item.excerpt}
                            </button>
                            <p className="mt-2 text-[11px] leading-relaxed text-muted">
                              Создано {formatMarkDate(item.createdAt)}
                              {item.updatedAt !== item.createdAt && (
                                <>
                                  {' '}
                                  · Изменено {formatMarkDate(item.updatedAt)}
                                </>
                              )}
                            </p>
                            <div className="mt-2 flex gap-3">
                              <button
                                className="text-muted hover:text-accent"
                                aria-label="Редактировать закладку"
                                onClick={() =>
                                  setBookmarkDraft({
                                    ...item,
                                    label: item.label ?? '',
                                  })
                                }
                              >
                                <Edit3 size={15} />
                              </button>
                              <button
                                className="text-danger"
                                aria-label="Удалить закладку"
                                onClick={() =>
                                  setDeleteDraft({
                                    kind: 'bookmark',
                                    id: item.id,
                                    description: item.label || item.excerpt,
                                  })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted">
                          {bookmarks.data?.length
                            ? 'Закладки не найдены.'
                            : 'Закладок пока нет.'}
                        </p>
                      )}
                    </div>
                  </section>
                )}
                {markType !== 'bookmarks' && (
                  <section>
                    <h2 className="text-sm font-semibold">
                      Выделения и заметки
                    </h2>
                    <div className="mt-2 space-y-2">
                      {filteredHighlights.length ? (
                        filteredHighlights.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-xl bg-subtle p-3 text-sm"
                          >
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-full ${markColors[item.color].split(' ')[0]}`}
                              title={markColorLabels[item.color]}
                            />
                            <button
                              className="ml-2 line-clamp-3 text-left align-top hover:text-accent"
                              onClick={() =>
                                openOffsetFromPanel(
                                  item.startOffset,
                                  'bookmark',
                                  'Выделение',
                                )
                              }
                            >
                              «{item.exactText}»
                            </button>
                            {item.note && (
                              <p className="mt-2 whitespace-pre-wrap text-muted">
                                {item.note}
                              </p>
                            )}
                            <p className="mt-2 text-[11px] leading-relaxed text-muted">
                              Создано {formatMarkDate(item.createdAt)}
                              {item.updatedAt !== item.createdAt && (
                                <>
                                  {' '}
                                  · Изменено {formatMarkDate(item.updatedAt)}
                                </>
                              )}
                            </p>
                            <div className="mt-2 flex gap-3">
                              <button
                                className="text-muted hover:text-accent"
                                aria-label="Редактировать выделение"
                                onClick={() =>
                                  setHighlightDraft({
                                    id: item.id,
                                    exactText: item.exactText,
                                    color: item.color,
                                    note: item.note ?? '',
                                  })
                                }
                              >
                                <Edit3 size={15} />
                              </button>
                              <button
                                className="text-danger"
                                aria-label="Удалить выделение"
                                onClick={() =>
                                  setDeleteDraft({
                                    kind: 'highlight',
                                    id: item.id,
                                    description: item.exactText,
                                  })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted">
                          {highlights.data?.length
                            ? 'Выделения не найдены.'
                            : 'Выделений пока нет.'}
                        </p>
                      )}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <section className="mt-4" aria-label="Поиск по книге">
                <label className="block text-sm font-medium">
                  Поиск по тексту
                  <span className="relative mt-2 block">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                      size={17}
                    />
                    <input
                      type="search"
                      className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Минимум 2 символа"
                    />
                  </span>
                </label>
                {searchInput.trim().length < 2 ? (
                  <p className="mt-4 text-sm text-muted">
                    Введите не менее двух символов.
                  </p>
                ) : searchResults.isPending ? (
                  <p className="mt-4 text-sm text-muted" role="status">
                    Ищем совпадения…
                  </p>
                ) : searchResults.isError ? (
                  <div className="mt-4 text-sm" role="alert">
                    <p className="text-danger">{searchResults.error.message}</p>
                    <Button
                      className="mt-3"
                      variant="outline"
                      onClick={() => void searchResults.refetch()}
                    >
                      Повторить
                    </Button>
                  </div>
                ) : searchResults.data.total === 0 ? (
                  <p className="mt-4 text-sm text-muted">
                    Совпадений не найдено.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Button
                        variant="outline"
                        className="px-3"
                        aria-label="Предыдущее совпадение"
                        disabled={
                          (activeSearchMatch?.index ?? 0) <= 0 ||
                          searchResults.isFetching
                        }
                        onClick={() => void moveSearch(-1)}
                      >
                        <ChevronLeft size={17} />
                      </Button>
                      <p
                        className="text-sm font-medium tabular-nums"
                        role="status"
                      >
                        {(activeSearchMatch?.index ??
                          searchResults.data.items[0]?.index ??
                          0) + 1}{' '}
                        из {searchResults.data.total}
                      </p>
                      <Button
                        variant="outline"
                        className="px-3"
                        aria-label="Следующее совпадение"
                        disabled={
                          (activeSearchMatch?.index ?? 0) + 1 >=
                            searchResults.data.total || searchResults.isFetching
                        }
                        onClick={() => void moveSearch(1)}
                      >
                        <ChevronRight size={17} />
                      </Button>
                    </div>
                    <div className="mt-4 max-h-[calc(100vh-17rem)] space-y-2 overflow-y-auto pr-1">
                      {searchResults.data.items.map((item) => (
                        <button
                          key={item.index}
                          type="button"
                          aria-current={
                            activeSearchMatch?.index === item.index
                              ? 'location'
                              : undefined
                          }
                          className={`w-full rounded-xl border p-3 text-left text-sm leading-6 transition ${activeSearchMatch?.index === item.index ? 'border-accent-line bg-accent-soft' : 'border-line bg-subtle/60 hover:border-accent-line'}`}
                          onClick={() => selectSearchMatch(item)}
                        >
                          <SearchExcerpt item={item} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
            </div>
          </aside>
        )}

        <main
          ref={readerViewport}
          className={`project-scrollbar relative min-w-0 flex-1 ${chromeVisible ? 'h-[calc(100dvh-4rem)]' : 'h-dvh'} ${themeClass} ${preferences.mode === 'scroll' || manifest.data.format === 'pdf' || manifest.data.format === 'docx' ? 'overflow-auto' : 'overflow-hidden'}`}
          style={{
            overflowAnchor: preferences.mode === 'scroll' ? 'none' : undefined,
          }}
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
        >
          {settingsOpen && (
            <section
              id="reader-settings"
              ref={settingsDialog}
              role="dialog"
              aria-label="Настройки чтения"
              tabIndex={-1}
              className="fixed right-3 top-20 z-40 max-h-[calc(100vh-5.75rem)] w-[min(92vw,360px)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Оформление</h2>
                <div className="flex items-center gap-1">
                <button type="button" className="p-2 text-muted" aria-label="Горячие клавиши" title="Горячие клавиши" onClick={() => setShortcutHelpOpen(true)}>
                  <Keyboard size={18} />
                </button>
                <button
                  aria-label="Закрыть настройки"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={19} />
                </button>
                </div>
              </div>
              {!['pdf', 'docx'].includes(manifest.data.format) ? (
                <>
                  <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Режим чтения">
                    {(
                      [
                        ['scroll', ScrollText, 'Прокрутка'],
                        ['page', List, 'Страница'],
                        ['spread', Columns2, 'Разворот'],
                      ] as const
                    ).map(([mode, Icon, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={preferences.mode === mode}
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
                  <p className="mt-5 block text-sm font-medium">
                    Размер шрифта
                  </p>
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
                          fontSize: Math.min(34, v.fontSize + 1),
                        }))
                      }
                    >
                      <Plus size={16} />
                    </Button>
                  </div>
                  <details className="mt-4 rounded-xl border border-line bg-page p-3">
                  <summary className="cursor-pointer text-sm font-semibold">Больше настроек</summary>
                  <label htmlFor="reader-font" className="mt-4 block text-sm font-medium">
                    Шрифт
                  </label>
                  <NativeSelect
                    id="reader-font"
                    containerClassName="mt-2 w-full"
                    className="w-full rounded-xl border border-line px-3 py-2"
                    value={preferences.font}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        font: event.target.value as ReaderFont,
                      }))
                    }
                  >
                    <option value="serif">Georgia — с засечками</option>
                    <option value="classic">Palatino — книжный</option>
                    <option value="sans">Системный — без засечек</option>
                    <option value="readable">Verdana — разборчивый</option>
                  </NativeSelect>
                  <label htmlFor="reader-line-height" className="mt-4 block text-sm font-medium">
                    Межстрочный интервал: {preferences.lineHeight.toFixed(1)}
                  </label>
                  <input
                    id="reader-line-height"
                    className="mt-2 w-full"
                    type="range"
                    min="1.3"
                    max="2.2"
                    step="0.1"
                    value={preferences.lineHeight}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        lineHeight: Number(event.target.value),
                      }))
                    }
                  />
                  <label htmlFor="reader-width" className="mt-4 block text-sm font-medium">
                    Ширина текста: {preferences.width}px
                  </label>
                  <input
                    id="reader-width"
                    className="mt-2 w-full"
                    type="range"
                    min="520"
                    max="1100"
                    step="20"
                    value={preferences.width}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        width: Number(event.target.value),
                      }))
                    }
                  />
                  <label htmlFor="reader-page-margin" className="mt-4 block text-sm font-medium">
                    Поля страницы: {preferences.pageMargin}px
                  </label>
                  <input
                    id="reader-page-margin"
                    className="mt-2 w-full"
                    type="range"
                    min="16"
                    max="96"
                    step="8"
                    value={preferences.pageMargin}
                    onChange={(event) =>
                      setPreferences((v) => ({
                        ...v,
                        pageMargin: Number(event.target.value),
                      }))
                    }
                  />
                  <div className="mt-4" role="group" aria-label="Выравнивание текста">
                    <p className="text-sm font-medium">Выравнивание текста</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([['left', 'По левому краю'], ['justify', 'По ширине']] as const).map(([align, label]) => (
                        <button
                          key={align}
                          type="button"
                          aria-pressed={preferences.textAlign === align}
                          className={`min-h-11 rounded-xl border px-2 py-2 text-sm ${preferences.textAlign === align ? 'border-accent-line bg-accent-soft text-accent' : 'border-line'}`}
                          onClick={() => setPreferences((value) => ({ ...value, textAlign: align }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  </details>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  Масштаб и страницы документа настраиваются в панели
                  просмотрщика.
                </p>
              )}
              <p className="mt-5 block text-sm font-medium">
                Тема страницы
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Тема страницы">
                {(
                  [
                    ['paper', 'Белая'],
                    ['sepia', 'Сепия'],
                    ['night', 'Тёмная'],
                  ] as const
                ).map(([theme, label]) => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={preferences.theme === theme}
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
            <Suspense
              fallback={
                <p className="grid h-full place-items-center" role="status">
                  Запускаем просмотрщик PDF…
                </p>
              }
            >
              <PdfReader
                bookId={id}
                title={manifest.data.title}
                sections={manifest.data.sections}
                activeOffset={activeOffset}
                mode={preferences.mode}
                viewportRef={readerViewport}
                searchQuery={searchQuery}
                highlights={highlights.data ?? []}
                hasTextLayer={manifest.data.sections.some(
                  (item) =>
                    item.endOffset - item.startOffset > item.title.length + 4,
                )}
                onModeChange={(mode) =>
                  setPreferences((value) => ({ ...value, mode }))
                }
                onActiveOffset={updateReaderOffset}
                onSelection={captureSelection}
              />
            </Suspense>
          ) : manifest.data.format === 'docx' ? (
            <Suspense
              fallback={
                <p className="grid h-full place-items-center" role="status">
                  Запускаем просмотрщик DOCX…
                </p>
              }
            >
              <DocxReader
                key={id}
                bookId={id}
                title={manifest.data.title}
                sections={manifest.data.sections}
                textLength={manifest.data.textLength}
                activeOffset={activeOffset}
                viewportRef={readerViewport}
                searchQuery={searchQuery}
                highlights={highlights.data ?? []}
                onActiveOffset={updateReaderOffset}
                onSelection={captureSelection}
              />
            </Suspense>
          ) : preferences.mode !== 'scroll' && section.isPending ? (
            <p className="p-10 text-center" role="status">
              Загружаем текст…
            </p>
          ) : preferences.mode !== 'scroll' && section.isError ? (
            <div className="p-10 text-center" role="alert">
              <p>{section.error?.message}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void section.refetch()}
              >
                Повторить
              </Button>
            </div>
          ) : (
            <>
              <div
                ref={readingArea}
                onMouseUp={captureSelection}
                className={`mx-auto reader-text-${preferences.textAlign} ${preferences.mode === 'scroll' ? `min-h-full py-8 sm:py-12 ${themeClass}` : `${chromeVisible ? 'h-[calc(100dvh-8rem)]' : 'h-dvh'} py-5 sm:py-8`}`}
                style={{
                  maxWidth:
                    preferences.mode === 'spread'
                      ? preferences.width * 2 + preferences.pageMargin * 2 + 50
                      : preferences.width + preferences.pageMargin * 2,
                  paddingInline: `min(${preferences.pageMargin}px, 12vw)`,
                }}
              >
                {preferences.mode === 'scroll' ? (
                  <ContinuousReader
                    bookId={id}
                    manifest={manifest.data}
                    initialOffset={activeOffset}
                    viewportRef={readerViewport}
                    navigation={scrollNavigation}
                    onNavigationSettled={handleNavigationSettled}
                    onActiveOffset={updateReaderOffset}
                    highlights={highlights.data ?? []}
                    searchMatches={searchResults.data?.items ?? []}
                    activeSearchIndex={activeSearchMatch?.index ?? null}
                    onNavigateLink={navigateSectionLink}
                    fontClass={fontClass}
                    fontSize={preferences.fontSize}
                    lineHeight={preferences.lineHeight}
                    width={preferences.width}
                    layoutKey={`${preferences.font}:${preferences.fontSize}:${preferences.lineHeight}:${preferences.width}:${preferences.pageMargin}:${preferences.textAlign}`}
                  />
                ) : (
                  <div
                    ref={pageFrame}
                    className="h-full w-full overflow-hidden overscroll-none"
                    style={{ touchAction: 'pan-y' }}
                  >
                    <article
                      ref={pagedContent}
                      data-reader-slice
                      data-base={currentMeta?.startOffset ?? 0}
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
                              onError={() =>
                                setLayoutEpoch((value) => value + 1)
                              }
                              className="mx-auto max-h-[55vh] max-w-full rounded-lg object-contain shadow-sm"
                            />
                          ))}
                        </div>
                      )}
                      <HighlightedText
                        text={section.data?.content ?? ''}
                        baseOffset={currentMeta?.startOffset ?? 0}
                        sectionStartOffset={currentMeta?.startOffset ?? 0}
                        highlights={highlights.data ?? []}
                        searchMatches={searchResults.data?.items ?? []}
                        activeSearchIndex={activeSearchMatch?.index ?? null}
                        links={section.data?.links ?? []}
                        onNavigateLink={navigateSectionLink}
                      />
                    </article>
                  </div>
                )}
              </div>

              {draft && (
                <div className={`fixed z-40 max-h-[min(70vh,520px)] w-[min(94vw,540px)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-foreground shadow-2xl ${draft.placeBelow ? '' : '-translate-y-full'}`} style={{ left: draft.anchorX, top: draft.anchorY }} role="dialog" aria-label="Действия с выделенным текстом">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 min-w-0 text-sm">«{draft.exactText}»</p>
                    <button type="button" className="shrink-0 p-1 text-muted" aria-label="Закрыть действия" onClick={() => setDraft(null)}><X size={17} /></button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Button className="px-2" onClick={() => addHighlight.mutate(draft)} disabled={addHighlight.isPending}>
                      <Highlighter size={16} /> Выделить
                    </Button>
                    <Button variant="outline" className="px-2" onClick={() => setSelectionEditorOpen((value) => !value)}>
                      <Edit3 size={16} /> Заметка
                    </Button>
                    <Button variant="outline" className="px-2" onClick={() => askAboutSelection(draft)}>
                      <MessageCircleQuestion size={16} /> Спросить
                    </Button>
                    <Button variant="outline" className="px-2" onClick={() => void copySelection(draft)}>
                      <Copy size={16} /> {selectionCopied ? 'Готово' : 'Копировать'}
                    </Button>
                  </div>
                  {addHighlight.isError && (
                    <p className="mt-3 text-sm text-danger" role="alert">
                      {addHighlight.error.message}
                    </p>
                  )}
                  {selectionEditorOpen && (
                    <div className="mt-3 border-t border-line pt-3">
                      <div className="flex gap-3">
                        {(['yellow', 'green', 'blue', 'pink'] as const).map((item) => (
                          <button key={item} type="button" aria-label={markColorLabels[item]} aria-pressed={color === item} className={`h-8 w-8 rounded-full ${markColors[item].split(' ')[0]} ${color === item ? 'ring-2 ring-accent ring-offset-2' : ''}`} onClick={() => setColor(item)} />
                        ))}
                      </div>
                      <textarea autoFocus className="mt-3 min-h-20 w-full rounded-xl border border-line px-3 py-2 text-sm" maxLength={2000} placeholder="Заметка к цитате" value={note} onChange={(event) => setNote(event.target.value)} />
                      <div className="mt-3 flex justify-end">
                        <Button onClick={() => addHighlight.mutate(draft)} disabled={addHighlight.isPending}>Сохранить заметку</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectionError && !draft && (
                <button
                  type="button"
                  className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-danger-soft px-4 py-2 text-sm text-danger shadow-xl"
                  onClick={() => setSelectionError('')}
                >
                  {selectionError}
                </button>
              )}

              {bookmarkDraft && (
                <ModalDialog
                  labelledBy="bookmark-editor-title"
                  onClose={() => setBookmarkDraft(null)}
                  closeDisabled={saveBookmark.isPending}
                  className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
                >
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveBookmark.mutate(bookmarkDraft)
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h2 id="bookmark-editor-title" className="font-semibold">
                        {bookmarkDraft.id
                          ? 'Редактировать закладку'
                          : 'Новая закладка'}
                      </h2>
                      <button
                        type="button"
                        aria-label="Закрыть"
                        onClick={() => setBookmarkDraft(null)}
                        disabled={saveBookmark.isPending}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <label className="mt-4 block text-sm font-medium">
                      Название
                      <input
                        autoFocus
                        className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3"
                        maxLength={160}
                        value={bookmarkDraft.label}
                        onChange={(event) =>
                          setBookmarkDraft((current) =>
                            current
                              ? { ...current, label: event.target.value }
                              : current,
                          )
                        }
                        placeholder="Например, важный разговор"
                      />
                    </label>
                    <p className="mt-3 line-clamp-4 rounded-xl bg-subtle p-3 text-sm text-muted">
                      {bookmarkDraft.excerpt}
                    </p>
                    {saveBookmark.isError && (
                      <p className="mt-3 text-sm text-danger" role="alert">
                        {saveBookmark.error.message}
                      </p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setBookmarkDraft(null)}
                        disabled={saveBookmark.isPending}
                      >
                        Отмена
                      </Button>
                      <Button type="submit" disabled={saveBookmark.isPending}>
                        Сохранить
                      </Button>
                    </div>
                  </form>
                </ModalDialog>
              )}

              {highlightDraft && (
                <ModalDialog
                  labelledBy="highlight-editor-title"
                  onClose={() => setHighlightDraft(null)}
                  closeDisabled={saveHighlight.isPending}
                  className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
                >
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveHighlight.mutate(highlightDraft)
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h2 id="highlight-editor-title" className="font-semibold">
                        Редактировать выделение
                      </h2>
                      <button
                        type="button"
                        aria-label="Закрыть"
                        onClick={() => setHighlightDraft(null)}
                        disabled={saveHighlight.isPending}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <p className="mt-4 line-clamp-5 rounded-xl bg-subtle p-3 text-sm">
                      «{highlightDraft.exactText}»
                    </p>
                    <fieldset className="mt-4">
                      <legend className="text-sm font-medium">Цвет</legend>
                      <div className="mt-2 flex gap-3">
                        {(
                          Object.keys(markColorLabels) as Highlight['color'][]
                        ).map((item) => (
                          <button
                            key={item}
                            type="button"
                            aria-label={markColorLabels[item]}
                            aria-pressed={highlightDraft.color === item}
                            className={`h-8 w-8 rounded-full ${markColors[item].split(' ')[0]} ${highlightDraft.color === item ? 'ring-2 ring-accent ring-offset-2' : ''}`}
                            onClick={() =>
                              setHighlightDraft((current) =>
                                current ? { ...current, color: item } : current,
                              )
                            }
                          />
                        ))}
                      </div>
                    </fieldset>
                    <label className="mt-4 block text-sm font-medium">
                      Заметка
                      <textarea
                        className="mt-2 min-h-28 w-full rounded-xl border border-line bg-surface px-3 py-2"
                        maxLength={2000}
                        value={highlightDraft.note}
                        onChange={(event) =>
                          setHighlightDraft((current) =>
                            current
                              ? { ...current, note: event.target.value }
                              : current,
                          )
                        }
                        placeholder="Добавьте комментарий к цитате"
                      />
                    </label>
                    {saveHighlight.isError && (
                      <p className="mt-3 text-sm text-danger" role="alert">
                        {saveHighlight.error.message}
                      </p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setHighlightDraft(null)}
                        disabled={saveHighlight.isPending}
                      >
                        Отмена
                      </Button>
                      <Button type="submit" disabled={saveHighlight.isPending}>
                        Сохранить
                      </Button>
                    </div>
                  </form>
                </ModalDialog>
              )}

              {deleteDraft && (
                <ModalDialog
                  labelledBy="delete-mark-title"
                  describedBy="delete-mark-description"
                  role="alertdialog"
                  onClose={() => setDeleteDraft(null)}
                  closeDisabled={
                    removeBookmark.isPending || removeHighlight.isPending
                  }
                  className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
                >
                  <h2 id="delete-mark-title" className="font-semibold">
                    Удалить отметку?
                  </h2>
                  <p
                    id="delete-mark-description"
                    className="mt-3 text-sm text-muted"
                  >
                    «{deleteDraft.description.slice(0, 220)}» будет удалено.
                  </p>
                  {(removeBookmark.isError || removeHighlight.isError) && (
                    <p className="mt-3 text-sm text-danger" role="alert">
                      {(removeBookmark.error ?? removeHighlight.error)?.message}
                    </p>
                  )}
                  <div className="mt-5 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setDeleteDraft(null)}
                      disabled={
                        removeBookmark.isPending || removeHighlight.isPending
                      }
                    >
                      Отмена
                    </Button>
                    <Button
                      className="bg-danger"
                      onClick={() =>
                        deleteDraft.kind === 'bookmark'
                          ? removeBookmark.mutate(deleteDraft.id)
                          : removeHighlight.mutate(deleteDraft.id)
                      }
                      disabled={
                        removeBookmark.isPending || removeHighlight.isPending
                      }
                    >
                      Удалить
                    </Button>
                  </div>
                </ModalDialog>
              )}

              {linkPreview && (
                <section
                  ref={linkPreviewPopup}
                  role="dialog"
                  aria-labelledby="link-preview-title"
                  className={`fixed z-50 w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl border border-line bg-surface p-4 text-foreground shadow-2xl ${linkPreview.placeBelow ? '' : '-translate-y-full'}`}
                  style={{
                    left: linkPreview.anchorX,
                    top: linkPreview.anchorY,
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-accent">{linkPreview.link.kind === 'note' ? 'Примечание' : 'Внутренняя ссылка'}</p>
                      <h2 id="link-preview-title" className="mt-1 font-semibold">{linkPreview.title}</h2>
                    </div>
                    <button type="button" className="p-1 text-muted" aria-label="Закрыть предпросмотр" onClick={() => setLinkPreview(null)}><X size={18} /></button>
                  </div>
                  {linkPreview.loading ? (
                    <p className="mt-4 text-sm text-muted" role="status">Загружаем фрагмент…</p>
                  ) : linkPreview.error ? (
                    <p className="mt-4 text-sm text-danger" role="alert">{linkPreview.error}</p>
                  ) : (
                    <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-page p-3 text-sm leading-6">{linkPreview.excerpt}</p>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setLinkPreview(null)}>Закрыть</Button>
                    <Button onClick={followPreviewLink}>Перейти</Button>
                  </div>
                </section>
              )}

              {shortcutHelpOpen && (
                <ModalDialog
                  labelledBy="reader-shortcuts-title"
                  onClose={() => setShortcutHelpOpen(false)}
                  className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h2 id="reader-shortcuts-title" className="font-semibold">Горячие клавиши</h2>
                    <button type="button" className="p-1 text-muted" aria-label="Закрыть справку" onClick={() => setShortcutHelpOpen(false)}><X size={18} /></button>
                  </div>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                    {[['← / →', 'Назад и вперёд'], ['Page Up / Page Down', 'Перелистывание'], ['/', 'Поиск по книге'], ['T', 'Оглавление'], ['B', 'Добавить закладку'], ['A', 'Открыть Книжника'], ['F', 'Полный экран'], ['?', 'Эта справка'], ['Esc', 'Закрыть окно или показать панели']].map(([key, label]) => (
                      <div key={key} className="contents"><dt><kbd className="rounded-md border border-line bg-page px-2 py-1 font-mono text-xs">{key}</kbd></dt><dd className="text-muted">{label}</dd></div>
                    ))}
                  </dl>
                </ModalDialog>
              )}

              {navigationOpen && (
                <section
                  id="reader-navigation"
                  ref={navigationDialog}
                  role="dialog"
                  aria-label="Переход по книге"
                  tabIndex={-1}
                  className="fixed bottom-20 left-1/2 z-40 max-h-[calc(100vh-6rem)] w-[min(92vw,420px)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-5 text-foreground shadow-2xl"
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
                  <form
                    className="mt-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      submitJump('percent', jumpPercent)
                    }}
                  >
                    <label
                      className="block text-sm font-medium"
                      htmlFor="jump-percent"
                    >
                      Процент книги
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="jump-percent"
                        className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.1"
                        value={jumpPercent}
                        onChange={(event) => setJumpPercent(event.target.value)}
                      />
                      <Button type="submit">Перейти</Button>
                    </div>
                  </form>
                  <form
                    className="mt-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      submitJump('offset', jumpOffset)
                    }}
                  >
                    <label
                      className="block text-sm font-medium"
                      htmlFor="jump-offset"
                    >
                      Глобальное смещение
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="jump-offset"
                        className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={manifest.data.textLength}
                        step="1"
                        value={jumpOffset}
                        onChange={(event) => setJumpOffset(event.target.value)}
                      />
                      <Button type="submit">Перейти</Button>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      От 0 до {manifest.data.textLength.toLocaleString('ru-RU')}
                    </p>
                  </form>
                  {jumpError && (
                    <p className="mt-3 text-sm text-danger" role="alert">
                      {jumpError}
                    </p>
                  )}
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

              {chromeVisible && (
                <footer className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-inherit px-4 py-3">
                <Button
                  variant="outline"
                  className="px-3"
                  aria-label="Назад по книге"
                  disabled={activeOffset <= 0}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={18} />
                </Button>
                <button
                  className="min-w-0 flex-1"
                  type="button"
                  aria-label="Перейти к проценту или позиции в книге"
                  aria-expanded={navigationOpen}
                  aria-controls={navigationOpen ? 'reader-navigation' : undefined}
                  onClick={() => {
                    setNavigationOpen((value) => {
                      if (!value) {
                        setJumpPercent(String(progress))
                        setJumpOffset(String(activeOffset))
                        setJumpError('')
                      }
                      return !value
                    })
                    setSettingsOpen(false)
                  }}
                  title="Перейти к проценту или позиции"
                >
                  <div className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                    <div
                      className="h-full overflow-hidden rounded-full bg-teal-600"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="mt-1 block text-xs opacity-70">
                    {preferences.mode === 'scroll'
                      ? `${progress}% · позиция ${activeOffset.toLocaleString('ru-RU')} из ${manifest.data.textLength.toLocaleString('ru-RU')}`
                      : `стр. ${pageIndex + 1}${pagesVisible === 2 && pageIndex + 2 <= pageCount ? `–${pageIndex + 2}` : ''} из ${pageCount} · ${progress}%`}
                  </span>
                  {(progressSync === 'offline' || progressSync === 'conflict') && (
                    <span className="mt-0.5 block text-[11px] opacity-70">
                      {progressSync === 'offline'
                        ? 'Позиция сохранена на устройстве'
                        : 'Сверяем позицию с другой вкладкой…'}
                    </span>
                  )}
                </button>
                <Button
                  variant="outline"
                  className="px-3"
                  aria-label="Вперёд по книге"
                  disabled={activeOffset >= manifest.data.textLength}
                  onClick={() => move(1)}
                >
                  <ChevronRight size={18} />
                </Button>
                </footer>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
