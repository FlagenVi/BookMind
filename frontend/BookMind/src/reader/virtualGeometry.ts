import type { BookSection, SectionContent } from '../api/books'

const TARGET_UNIT_CHARS = 30_000
const MIN_UNIT_CHARS = 20_000
const MAX_UNIT_CHARS = 40_000
export const MAX_WINDOW_CHARS = 240_000
export const MAX_WINDOW_UNITS = 9

export type ReaderUnit = {
  id: string
  sectionNumber: number
  sectionStartOffset: number
  startOffset: number
  endOffset: number
  localStart: number
  localEnd: number
  isSectionStart: boolean
}

function contentBreaks(content: string) {
  if (content.length <= MAX_UNIT_CHARS) return [0, content.length]
  const breaks = [0]
  while (content.length - breaks[breaks.length - 1] > MAX_UNIT_CHARS) {
    const start = breaks[breaks.length - 1]
    const minimum = start + MIN_UNIT_CHARS
    const maximum = Math.min(content.length, start + MAX_UNIT_CHARS)
    const desired = start + TARGET_UNIT_CHARS
    let boundary = content.indexOf('\n', desired)
    if (boundary < minimum || boundary > maximum)
      boundary = content.lastIndexOf('\n', maximum)
    if (boundary < minimum) boundary = Math.min(maximum, desired)
    while (
      boundary < maximum &&
      boundary < content.length &&
      content[boundary] === '\n'
    )
      boundary++
    breaks.push(boundary)
  }
  breaks.push(content.length)
  return breaks
}

function estimatedBreaks(length: number) {
  if (length <= MAX_UNIT_CHARS) return [0, length]
  const breaks = [0]
  while (length - breaks[breaks.length - 1] > MAX_UNIT_CHARS)
    breaks.push(breaks[breaks.length - 1] + TARGET_UNIT_CHARS)
  breaks.push(length)
  return breaks
}

export function buildUnits(
  sections: BookSection[],
  contentBySection: Map<number, SectionContent>,
) {
  return sections.flatMap((section) => {
    const content = contentBySection.get(section.number)?.content
    const sectionLength = Math.max(0, section.endOffset - section.startOffset)
    const breaks = content
      ? contentBreaks(content)
      : estimatedBreaks(sectionLength)
    return breaks.slice(0, -1).map((localStart, index) => {
      const localEnd = Math.min(sectionLength, breaks[index + 1])
      return {
        id: `${section.number}:${localStart}`,
        sectionNumber: section.number,
        sectionStartOffset: section.startOffset,
        startOffset: section.startOffset + localStart,
        endOffset: section.startOffset + localEnd,
        localStart,
        localEnd,
        isSectionStart: index === 0,
      } satisfies ReaderUnit
    })
  })
}

export function unitForOffset(units: ReaderUnit[], offset: number) {
  const index = units.findIndex(
    (unit, unitIndex) =>
      offset >= unit.startOffset &&
      (offset < unit.endOffset || unitIndex === units.length - 1),
  )
  return Math.max(0, index)
}

export function selectUnitWindow(units: ReaderUnit[], offset: number) {
  if (!units.length) return { start: 0, end: 0, units: [] as ReaderUnit[] }
  let start = unitForOffset(units, offset)
  let end = start + 1
  let chars = units[start].endOffset - units[start].startOffset
  while (end - start < MAX_WINDOW_UNITS) {
    const canBefore = start > 0
    const canAfter = end < units.length
    if (!canBefore && !canAfter) break
    const preferBefore =
      canBefore &&
      (!canAfter ||
        end - unitForOffset(units, offset) >
          unitForOffset(units, offset) - start)
    const candidate = preferBefore ? units[start - 1] : units[end]
    const candidateChars = candidate.endOffset - candidate.startOffset
    if (chars + candidateChars > MAX_WINDOW_CHARS) break
    if (preferBefore) start--
    else end++
    chars += candidateChars
  }
  return { start, end, units: units.slice(start, end) }
}

export function estimateUnitHeight(
  unit: ReaderUnit,
  width: number,
  fontSize: number,
  lineHeight: number,
) {
  const characters = Math.max(1, unit.endOffset - unit.startOffset)
  const charactersPerLine = Math.max(22, width / (fontSize * 0.54))
  const lines = Math.ceil(characters / charactersPerLine)
  const sectionGap = unit.isSectionStart && unit.startOffset > 0 ? 56 : 0
  return Math.max(120, lines * fontSize * lineHeight + sectionGap)
}

export function spacerHeight(
  units: ReaderUnit[],
  from: number,
  to: number,
  measurements: Map<string, number>,
  width: number,
  fontSize: number,
  lineHeight: number,
) {
  let height = 0
  for (let index = from; index < to; index++)
    height +=
      measurements.get(units[index].id) ??
      estimateUnitHeight(units[index], width, fontSize, lineHeight)
  return height
}
