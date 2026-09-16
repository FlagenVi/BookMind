import type { BookSection } from '../api/books'
import { anchorFromOffset, type ProgressAnchor } from './textAnchors.ts'

export const SIDEBAR_TAB_KEY = 'reader-sidebar-tab:v1'
export const NAVIGATION_HISTORY_LIMIT = 40
export type SidebarTab = 'toc' | 'marks' | 'search'
export type NavigationSource =
  'toc' | 'search' | 'bookmark' | 'percent' | 'offset' | 'internal'

export type HistoryAnchor = ProgressAnchor & {
  source: NavigationSource
  label?: string
}

export function parseSidebarTab(value: string | null): SidebarTab {
  return value === 'marks' || value === 'search' || value === 'toc'
    ? value
    : 'toc'
}

export function pushHistoryAnchor(
  history: HistoryAnchor[],
  anchor: HistoryAnchor,
  limit = NAVIGATION_HISTORY_LIMIT,
  duplicateDistance = 64,
) {
  const last = history.at(-1)
  if (
    last &&
    last.sectionNumber === anchor.sectionNumber &&
    Math.abs(last.sectionOffset - anchor.sectionOffset) <= duplicateDistance
  )
    return history
  return [...history, anchor].slice(-limit)
}

export function historyAnchorAtOffset(
  positionOffset: number,
  sections: BookSection[],
  textLength: number,
  source: NavigationSource,
  label?: string,
): HistoryAnchor {
  return {
    ...anchorFromOffset(positionOffset, sections, textLength),
    source,
    label,
  }
}

export function confirmedOffsetAfter(
  confirmedOffset: number,
  positionOffset: number,
  source: 'user' | 'programmatic',
) {
  return source === 'user'
    ? Math.max(confirmedOffset, positionOffset)
    : confirmedOffset
}

export function parseJumpTarget(
  kind: 'percent' | 'offset',
  rawValue: string,
  textLength: number,
): { offset?: number; error?: string } {
  if (!rawValue.trim()) return { error: 'Введите значение.' }
  const value = Number(rawValue.replace(',', '.'))
  if (!Number.isFinite(value)) return { error: 'Введите число.' }
  if (kind === 'percent') {
    if (value < 0 || value > 100)
      return { error: 'Процент должен быть от 0 до 100.' }
    return { offset: Math.round((textLength * value) / 100) }
  }
  if (!Number.isInteger(value))
    return { error: 'Смещение должно быть целым числом.' }
  if (value < 0 || value > textLength)
    return { error: `Смещение должно быть от 0 до ${textLength}.` }
  return { offset: value }
}
