import { performance } from 'node:perf_hooks'
import process from 'node:process'
import type { BookSection, SectionContent } from '../src/api/books.ts'
import {
  MAX_WINDOW_CHARS,
  MAX_WINDOW_UNITS,
  buildUnits,
  selectUnitWindow,
} from '../src/reader/virtualGeometry.ts'

const SIZES = [1_000_000, 5_000_000, 10_000_000]
const SECTION_CHARS = 200_000
const RUNS = 25

function manifestFor(textLength: number) {
  return Array.from(
    { length: Math.ceil(textLength / SECTION_CHARS) },
    (_, number) => ({
      number,
      title: `Глава ${number + 1}`,
      startOffset: number * SECTION_CHARS,
      endOffset: Math.min(textLength, (number + 1) * SECTION_CHARS),
    }),
  ) satisfies BookSection[]
}

function contentFor(section: BookSection): SectionContent {
  const length = section.endOffset - section.startOffset
  const paragraph = `${'Большая синтетическая книга. '.repeat(120)}\n`
  return {
    content: paragraph
      .repeat(Math.ceil(length / paragraph.length))
      .slice(0, length),
    assets: [],
  }
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

function collectGarbage() {
  globalThis.gc?.()
  globalThis.gc?.()
}

const results = SIZES.map((textLength) => {
  const sections = manifestFor(textLength)
  const focusOffset = Math.floor(textLength * 0.82)
  const targetIndex = sections.findIndex(
    (section) =>
      focusOffset >= section.startOffset && focusOffset < section.endOffset,
  )
  const preparationTimings: number[] = []
  const openingTimings: number[] = []
  let visibleUnits = 0
  let mountedChars = 0

  for (let run = 0; run < RUNS; run++) {
    const preparationStarted = performance.now()
    const estimatedUnits = buildUnits(manifestFor(textLength), new Map())
    selectUnitWindow(estimatedUnits, focusOffset)
    preparationTimings.push(performance.now() - preparationStarted)

    const openingStarted = performance.now()
    const content = new Map<number, SectionContent>()
    for (
      let index = Math.max(0, targetIndex - 1);
      index <= Math.min(sections.length - 1, targetIndex + 1);
      index++
    )
      content.set(sections[index].number, contentFor(sections[index]))
    const units = buildUnits(sections, content)
    const window = selectUnitWindow(units, focusOffset)
    openingTimings.push(performance.now() - openingStarted)
    visibleUnits = window.units.length
    mountedChars = window.units.reduce(
      (total, unit) => total + unit.endOffset - unit.startOffset,
      0,
    )
  }

  collectGarbage()
  const before = process.memoryUsage().heapUsed
  const content = new Map<number, SectionContent>()
  for (
    let index = Math.max(0, targetIndex - 1);
    index <= Math.min(sections.length - 1, targetIndex + 1);
    index++
  )
    content.set(sections[index].number, contentFor(sections[index]))
  const units = buildUnits(sections, content)
  const window = selectUnitWindow(units, focusOffset)
  collectGarbage()
  const heapDeltaMiB =
    Math.max(0, process.memoryUsage().heapUsed - before) / 2 ** 20

  if (visibleUnits > MAX_WINDOW_UNITS || mountedChars > MAX_WINDOW_CHARS)
    throw new Error(`Window limit exceeded for ${textLength} characters`)

  return {
    characters: textLength,
    sections: sections.length,
    units: units.length,
    prepareMedianMs: percentile(preparationTimings, 0.5),
    openMedianMs: percentile(openingTimings, 0.5),
    openP95Ms: percentile(openingTimings, 0.95),
    mountedUnits: window.units.length,
    mountedCharacters: window.units.reduce(
      (total, unit) => total + unit.endOffset - unit.startOffset,
      0,
    ),
    retainedHeapDeltaMiB: heapDeltaMiB,
  }
})

console.table(
  results.map((result) => ({
    ...result,
    prepareMedianMs: result.prepareMedianMs.toFixed(3),
    openMedianMs: result.openMedianMs.toFixed(3),
    openP95Ms: result.openP95Ms.toFixed(3),
    retainedHeapDeltaMiB: result.retainedHeapDeltaMiB.toFixed(3),
  })),
)
console.log(
  JSON.stringify({ node: process.version, runs: RUNS, results }, null, 2),
)
