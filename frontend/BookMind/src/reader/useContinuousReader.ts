import { useEffect, useRef } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { booksApi, type BookManifest, type SectionContent } from '../api/books'
import {
  buildUnits,
  estimateUnitHeight,
  selectUnitWindow,
  spacerHeight,
} from './virtualGeometry'
import { sectionForOffset } from './textAnchors'
import { selectSectionEvictions } from './sectionCache'

const SECTION_GC_TIME = 10 * 60 * 1000

export function useContinuousReader({
  bookId,
  manifest,
  focusOffset,
  width,
  fontSize,
  lineHeight,
  measurements,
}: {
  bookId: string
  manifest: BookManifest
  focusOffset: number
  width: number
  fontSize: number
  lineHeight: number
  measurements: Map<string, number>
}) {
  const queryClient = useQueryClient()
  const accessTimes = useRef(new Map<number, number>())
  const accessClock = useRef(0)
  const targetMeta = sectionForOffset(manifest.sections, focusOffset)
  const targetQuery = useQuery({
    queryKey: ['book', bookId, 'section', targetMeta?.number],
    queryFn: ({ signal }) =>
      booksApi.section(bookId, targetMeta!.number, signal),
    enabled: !!targetMeta,
    staleTime: Infinity,
    gcTime: SECTION_GC_TIME,
  })

  const cachedContent = new Map<number, SectionContent>()
  for (const [key, value] of queryClient.getQueriesData<SectionContent>({
    queryKey: ['book', bookId, 'section'],
  })) {
    const number = key[3]
    if (typeof number === 'number' && value) cachedContent.set(number, value)
  }
  if (targetMeta && targetQuery.data)
    cachedContent.set(targetMeta.number, targetQuery.data)

  const initialUnits = buildUnits(manifest.sections, cachedContent)
  const initialWindow = selectUnitWindow(initialUnits, focusOffset)
  const neighborNumbers = Array.from(
    new Set(
      initialWindow.units
        .map((unit) => unit.sectionNumber)
        .filter((number) => number !== targetMeta?.number),
    ),
  ).sort((a, b) => {
    const targetIndex = manifest.sections.findIndex(
      (section) => section.number === targetMeta?.number,
    )
    const aIndex = manifest.sections.findIndex(
      (section) => section.number === a,
    )
    const bIndex = manifest.sections.findIndex(
      (section) => section.number === b,
    )
    return Math.abs(aIndex - targetIndex) - Math.abs(bIndex - targetIndex)
  })

  const neighborQueries = useQueries({
    queries: neighborNumbers.map((number) => ({
      queryKey: ['book', bookId, 'section', number] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        booksApi.section(bookId, number, signal),
      enabled: targetQuery.isSuccess,
      staleTime: Infinity,
      gcTime: SECTION_GC_TIME,
    })),
  })
  neighborQueries.forEach((query, index) => {
    if (query.data) cachedContent.set(neighborNumbers[index], query.data)
  })

  const units = buildUnits(manifest.sections, cachedContent)
  const window = selectUnitWindow(units, focusOffset)
  const keepSectionSignature = Array.from(
    new Set(window.units.map((unit) => unit.sectionNumber)),
  ).join(',')
  const errors = new Map<number, Error>()
  const retries = new Map<number, () => void>()
  if (targetMeta) {
    if (targetQuery.error) errors.set(targetMeta.number, targetQuery.error)
    retries.set(targetMeta.number, () => void targetQuery.refetch())
  }
  neighborQueries.forEach((query, index) => {
    const number = neighborNumbers[index]
    if (query.error) errors.set(number, query.error)
    retries.set(number, () => void query.refetch())
  })

  const contentSignature = Array.from(cachedContent.entries())
    .map(([number, content]) => `${number}:${content.content.length}`)
    .join('|')

  useEffect(() => {
    const keepSections = new Set(
      keepSectionSignature.split(',').filter(Boolean).map(Number),
    )
    const accessOrder = ++accessClock.current
    for (const number of keepSections)
      accessTimes.current.set(number, accessOrder)
    const cached = queryClient
      .getQueriesData<SectionContent>({
        queryKey: ['book', bookId, 'section'],
      })
      .filter(
        (entry): entry is [readonly unknown[], SectionContent] => !!entry[1],
      )
    const evictions = selectSectionEvictions(
      cached.map(([key, content]) => ({
        key,
        sectionNumber: key[3] as number,
        contentLength: content.content.length,
        lastAccess: accessTimes.current.get(key[3] as number) ?? 0,
        protected: keepSections.has(key[3] as number),
      })),
    )
    for (const item of evictions) {
      queryClient.removeQueries({ queryKey: item.key, exact: true })
      accessTimes.current.delete(item.sectionNumber)
    }
  }, [bookId, contentSignature, keepSectionSignature, queryClient])

  return {
    units,
    visibleUnits: window.units,
    contentBySection: cachedContent,
    errors,
    retries,
    targetPending: targetQuery.isPending,
    targetError: targetQuery.error,
    windowSignature: window.units
      .map(
        (unit) =>
          `${unit.id}:${cachedContent.has(unit.sectionNumber) ? 'loaded' : 'pending'}`,
      )
      .join('|'),
    topSpacer: spacerHeight(
      units,
      0,
      window.start,
      measurements,
      width,
      fontSize,
      lineHeight,
    ),
    bottomSpacer: spacerHeight(
      units,
      window.end,
      units.length,
      measurements,
      width,
      fontSize,
      lineHeight,
    ),
    estimateHeight: (unit: (typeof units)[number]) =>
      measurements.get(unit.id) ??
      estimateUnitHeight(unit, width, fontSize, lineHeight),
  }
}
