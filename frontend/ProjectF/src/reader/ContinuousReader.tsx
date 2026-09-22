import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type {
  BookManifest,
  BookSearchItem,
  Highlight,
  SectionLink,
} from '../api/books'
import { ReaderSlice } from './ReaderSlice'
import { localOffsetAtY, textRectAtOffset } from './textAnchors'
import { useContinuousReader } from './useContinuousReader'

export type ScrollNavigation = {
  id: number
  offset: number
  behavior: ScrollBehavior
  announce: boolean
}

function markerY(viewport: HTMLElement) {
  return (
    viewport.getBoundingClientRect().top +
    Math.min(160, viewport.clientHeight * 0.22)
  )
}

function offsetAtMarker(viewport: HTMLElement, fallback: number) {
  const targetY = markerY(viewport)
  const elements = Array.from(
    viewport.querySelectorAll<HTMLElement>('[data-reader-slice]'),
  )
  if (!elements.length) return fallback
  const element =
    elements.find((item) => item.getBoundingClientRect().bottom >= targetY) ??
    elements[elements.length - 1]
  const start = Number(element.dataset.base ?? fallback)
  const end = Number(element.dataset.end ?? start)
  const text = element.querySelector<HTMLElement>('[data-reader-text]')
  if (!text) {
    const rect = element.getBoundingClientRect()
    const ratio = Math.max(
      0,
      Math.min(1, (targetY - rect.top) / Math.max(1, rect.height)),
    )
    return Math.round(start + (end - start) * ratio)
  }
  return start + localOffsetAtY(text, targetY, Math.max(0, end - start))
}

export function ContinuousReader({
  bookId,
  manifest,
  initialOffset,
  viewportRef,
  navigation,
  onNavigationSettled,
  onActiveOffset,
  highlights,
  searchMatches,
  activeSearchIndex,
  onNavigateLink,
  fontClass,
  fontSize,
  lineHeight,
  width,
  layoutKey,
}: {
  bookId: string
  manifest: BookManifest
  initialOffset: number
  viewportRef: MutableRefObject<HTMLElement | null>
  navigation: ScrollNavigation | null
  onNavigationSettled: (id: number) => void
  onActiveOffset: (offset: number, source: 'user' | 'programmatic') => void
  highlights: Highlight[]
  searchMatches: BookSearchItem[]
  activeSearchIndex: number | null
  onNavigateLink: (link: SectionLink, anchor: DOMRect) => void
  fontClass: string
  fontSize: number
  lineHeight: number
  width: number
  layoutKey: string
}) {
  const [focusOffset, setFocusOffset] = useState(
    navigation?.offset ?? initialOffset,
  )
  const [measurements, setMeasurements] = useState(new Map<string, number>())
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const [restoring, setRestoring] = useState(true)
  const focusOffsetRef = useRef(navigation?.offset ?? initialOffset)
  const nodes = useRef(new Map<string, HTMLElement>())
  const resizeObserver = useRef<ResizeObserver | null>(null)
  const resizeFrame = useRef(0)
  const scrollFrame = useRef(0)
  const programmaticScroll = useRef(false)
  const programmaticTimer = useRef(0)
  const pendingAnchor = useRef<number | null>(null)
  const previousLayoutKey = useRef(layoutKey)
  const previousWindowSignature = useRef('')
  const [initialNavigation] = useState<ScrollNavigation>(() => ({
    id: -1,
    offset: navigation?.offset ?? initialOffset,
    behavior: 'auto',
    announce: true,
  }))
  const requestedNavigation =
    navigation ?? (restoring ? initialNavigation : null)
  const queryOffset = navigation?.offset ?? focusOffset

  const reader = useContinuousReader({
    bookId,
    manifest,
    focusOffset: queryOffset,
    width,
    fontSize,
    lineHeight,
    measurements,
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => setViewport(viewportRef.current))
    return () => cancelAnimationFrame(frame)
  }, [viewportRef])

  const placeOffset = useCallback(
    (offset: number, behavior: ScrollBehavior) => {
      const targetViewport = viewportRef.current
      if (!targetViewport) return false
      const unit = reader.visibleUnits.find(
        (item, index) =>
          offset >= item.startOffset &&
          (offset < item.endOffset || index === reader.visibleUnits.length - 1),
      )
      const element = unit ? nodes.current.get(unit.id) : undefined
      const text = element?.querySelector<HTMLElement>('[data-reader-text]')
      if (!unit || !element || !text) return false
      const rect = textRectAtOffset(
        text,
        Math.max(0, offset - unit.startOffset),
      )
      const delta = rect.top - markerY(targetViewport)
      programmaticScroll.current = true
      window.clearTimeout(programmaticTimer.current)
      programmaticTimer.current = window.setTimeout(
        () => {
          programmaticScroll.current = false
        },
        behavior === 'smooth' ? 1_500 : 64,
      )
      targetViewport.scrollTo({
        top: Math.max(0, targetViewport.scrollTop + delta),
        behavior,
      })
      focusOffsetRef.current = offset
      return true
    },
    [reader.visibleUnits, viewportRef],
  )

  useLayoutEffect(() => {
    if (!requestedNavigation || reader.targetPending || reader.targetError)
      return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (
          !placeOffset(requestedNavigation.offset, requestedNavigation.behavior)
        )
          return
        setFocusOffset(requestedNavigation.offset)
        focusOffsetRef.current = requestedNavigation.offset
        onActiveOffset(requestedNavigation.offset, 'programmatic')
        setRestoring(false)
        onNavigationSettled(requestedNavigation.id)
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [
    requestedNavigation,
    onActiveOffset,
    onNavigationSettled,
    placeOffset,
    reader.targetError,
    reader.targetPending,
  ])

  useLayoutEffect(() => {
    if (previousLayoutKey.current === layoutKey) return
    previousLayoutKey.current = layoutKey
    const targetViewport = viewportRef.current
    if (!targetViewport) return
    const anchor = focusOffset
    setFocusOffset(anchor)
    requestAnimationFrame(() => placeOffset(anchor, 'auto'))
  }, [focusOffset, layoutKey, placeOffset, viewportRef])

  useLayoutEffect(() => {
    if (previousWindowSignature.current === reader.windowSignature) return
    previousWindowSignature.current = reader.windowSignature
    if (!reader.targetPending) placeOffset(focusOffsetRef.current, 'auto')
  }, [placeOffset, reader.targetPending, reader.windowSignature])

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    if (anchor === null) return
    pendingAnchor.current = null
    placeOffset(anchor, 'auto')
  }, [measurements, placeOffset, reader.visibleUnits])

  useEffect(() => {
    resizeObserver.current = new ResizeObserver((entries) => {
      if (resizeFrame.current) cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = requestAnimationFrame(() => {
        setMeasurements((current) => {
          const next = new Map(current)
          let changed = false
          for (const entry of entries) {
            const element = entry.target as HTMLElement
            const id = element.dataset.unitId
            const height =
              entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
            if (id && Math.abs((next.get(id) ?? 0) - height) > 1) {
              next.set(id, height)
              changed = true
            }
          }
          if (changed && viewportRef.current)
            pendingAnchor.current = focusOffsetRef.current
          return changed ? next : current
        })
      })
    })
    for (const node of nodes.current.values())
      resizeObserver.current.observe(node)
    return () => {
      resizeObserver.current?.disconnect()
      resizeObserver.current = null
      if (resizeFrame.current) cancelAnimationFrame(resizeFrame.current)
    }
  }, [viewportRef])

  useEffect(() => {
    const targetViewport = viewportRef.current
    if (!targetViewport) return
    const onScroll = () => {
      if (programmaticScroll.current) return
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current)
      scrollFrame.current = requestAnimationFrame(() => {
        const offset = offsetAtMarker(targetViewport, focusOffsetRef.current)
        focusOffsetRef.current = offset
        setFocusOffset(offset)
        onActiveOffset(offset, 'user')
        scrollFrame.current = 0
      })
    }
    const finishProgrammaticScroll = () => {
      programmaticScroll.current = false
      window.clearTimeout(programmaticTimer.current)
    }
    targetViewport.addEventListener('scroll', onScroll, { passive: true })
    targetViewport.addEventListener('scrollend', finishProgrammaticScroll)
    targetViewport.addEventListener('pointerdown', finishProgrammaticScroll, {
      passive: true,
    })
    targetViewport.addEventListener('wheel', finishProgrammaticScroll, {
      passive: true,
    })
    return () => {
      targetViewport.removeEventListener('scroll', onScroll)
      targetViewport.removeEventListener('scrollend', finishProgrammaticScroll)
      targetViewport.removeEventListener(
        'pointerdown',
        finishProgrammaticScroll,
      )
      targetViewport.removeEventListener('wheel', finishProgrammaticScroll)
      window.clearTimeout(programmaticTimer.current)
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current)
    }
  }, [onActiveOffset, viewportRef])

  const registerNode = useCallback(
    (unitId: string, node: HTMLElement | null) => {
      const previous = nodes.current.get(unitId)
      if (previous && previous !== node)
        resizeObserver.current?.unobserve(previous)
      if (!node) {
        nodes.current.delete(unitId)
        return
      }
      nodes.current.set(unitId, node)
      resizeObserver.current?.observe(node)
    },
    [],
  )

  if (reader.targetError) {
    const targetNumber = reader.visibleUnits.find(
      (unit) =>
        focusOffset >= unit.startOffset && focusOffset <= unit.endOffset,
    )?.sectionNumber
    return (
      <div className="p-10 text-center" role="alert">
        <p>{reader.targetError.message}</p>
        {targetNumber !== undefined && (
          <button
            className="mt-4 underline"
            onClick={reader.retries.get(targetNumber)}
          >
            Повторить
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {(restoring || navigation?.announce || reader.targetPending) && (
        <p
          className="sticky top-4 z-10 mx-auto w-fit rounded-full bg-surface/95 px-4 py-2 text-sm text-muted shadow-lg"
          role="status"
        >
          Восстанавливаем место чтения…
        </p>
      )}
      <div>
        <div aria-hidden="true" style={{ height: reader.topSpacer }} />
        {reader.visibleUnits.map((unit) => (
          <ReaderSlice
            key={unit.id}
            onNode={registerNode}
            bookId={bookId}
            unit={unit}
            content={reader.contentBySection.get(unit.sectionNumber)}
            viewport={viewport}
            highlights={highlights}
            searchMatches={searchMatches}
            activeSearchIndex={activeSearchIndex}
            onNavigateLink={onNavigateLink}
            fontClass={fontClass}
            fontSize={fontSize}
            lineHeight={lineHeight}
            estimatedHeight={reader.estimateHeight(unit)}
            error={reader.errors.get(unit.sectionNumber)}
            onRetry={reader.retries.get(unit.sectionNumber)}
          />
        ))}
        <div aria-hidden="true" style={{ height: reader.bottomSpacer }} />
      </div>
    </>
  )
}
