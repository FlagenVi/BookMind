import type { BookSearchItem, Highlight, SectionLink } from '../api/books'

export type ReaderTextSegment = {
  startOffset: number
  endOffset: number
  text: string
  highlight?: Highlight
  search: 'active' | 'visible' | null
  link?: SectionLink
}

export function segmentReaderText({
  text,
  baseOffset,
  sectionStartOffset,
  highlights,
  searchMatches,
  activeSearchIndex,
  links,
}: {
  text: string
  baseOffset: number
  sectionStartOffset: number
  highlights: Highlight[]
  searchMatches: BookSearchItem[]
  activeSearchIndex: number | null
  links: SectionLink[]
}) {
  const endOffset = baseOffset + text.length
  const relevantHighlights = highlights.filter(
    (item) => item.startOffset < endOffset && item.endOffset > baseOffset,
  )
  const relevantSearch = searchMatches.filter(
    (item) =>
      item.positionOffset < endOffset &&
      item.positionOffset + item.length > baseOffset,
  )
  const relevantLinks = links
    .filter((link) => link.kind === 'internal' || link.kind === 'note')
    .map((link) => ({
      link,
      startOffset: sectionStartOffset + link.startOffset,
      endOffset: sectionStartOffset + link.endOffset,
    }))
    .filter(
      (item) => item.startOffset < endOffset && item.endOffset > baseOffset,
    )
  const boundaries = new Set([baseOffset, endOffset])
  for (const item of relevantHighlights) {
    boundaries.add(Math.max(baseOffset, item.startOffset))
    boundaries.add(Math.min(endOffset, item.endOffset))
  }
  for (const item of relevantSearch) {
    boundaries.add(Math.max(baseOffset, item.positionOffset))
    boundaries.add(Math.min(endOffset, item.positionOffset + item.length))
  }
  for (const item of relevantLinks) {
    boundaries.add(Math.max(baseOffset, item.startOffset))
    boundaries.add(Math.min(endOffset, item.endOffset))
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b)
  return sorted.slice(0, -1).map((startOffset, index) => {
    const segmentEnd = sorted[index + 1]
    const highlight = relevantHighlights.find(
      (item) => item.startOffset < segmentEnd && item.endOffset > startOffset,
    )
    const searchMatch = relevantSearch.find(
      (item) =>
        item.positionOffset < segmentEnd &&
        item.positionOffset + item.length > startOffset,
    )
    const link = relevantLinks.find(
      (item) => item.startOffset < segmentEnd && item.endOffset > startOffset,
    )?.link
    return {
      startOffset,
      endOffset: segmentEnd,
      text: text.slice(startOffset - baseOffset, segmentEnd - baseOffset),
      highlight,
      search: searchMatch
        ? searchMatch.index === activeSearchIndex
          ? 'active'
          : 'visible'
        : null,
      link,
    } satisfies ReaderTextSegment
  })
}
