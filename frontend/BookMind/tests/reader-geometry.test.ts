import assert from 'node:assert/strict'
import test from 'node:test'
import type { BookSection, SectionContent } from '../src/api/books.ts'
import {
  MAX_WINDOW_CHARS,
  MAX_WINDOW_UNITS,
  buildUnits,
  estimateUnitHeight,
  selectUnitWindow,
  spacerHeight,
  unitForOffset,
} from '../src/reader/virtualGeometry.ts'

function section(length: number): BookSection {
  return {
    number: 0,
    title: 'Большая глава',
    startOffset: 0,
    endOffset: length,
  }
}

test('large chapter is split into contiguous units near paragraph boundaries', () => {
  const paragraph = `${'текст '.repeat(800)}\n`
  const content = paragraph.repeat(30)
  const contentBySection = new Map<number, SectionContent>([
    [0, { content, assets: [] }],
  ])
  const units = buildUnits([section(content.length)], contentBySection)

  assert.ok(units.length > 1)
  assert.equal(units[0].startOffset, 0)
  assert.equal(units.at(-1)?.endOffset, content.length)
  for (let index = 0; index < units.length; index++) {
    assert.ok(units[index].endOffset - units[index].startOffset <= 40_000)
    if (index)
      assert.equal(units[index - 1].endOffset, units[index].startOffset)
  }
})

test('long runs of newlines cannot produce an oversized window unit', () => {
  const content = `${'a'.repeat(30_000)}${'\n'.repeat(300_000)}${'b'.repeat(30_000)}`
  const units = buildUnits(
    [section(content.length)],
    new Map([[0, { content, assets: [] }]]),
  )
  const window = selectUnitWindow(units, 100_000)
  const mountedChars = window.units.reduce(
    (total, unit) => total + unit.endOffset - unit.startOffset,
    0,
  )

  assert.ok(units.every((unit) => unit.endOffset - unit.startOffset <= 40_000))
  assert.ok(window.units.length <= MAX_WINDOW_UNITS)
  assert.ok(mountedChars <= MAX_WINDOW_CHARS)
})

test('window contains the requested offset and respects both limits', () => {
  const sections = Array.from({ length: 60 }, (_, number) => ({
    number,
    title: `Глава ${number + 1}`,
    startOffset: number * 200_000,
    endOffset: (number + 1) * 200_000,
  }))
  const units = buildUnits(sections, new Map())
  const offset = 9_876_543
  const window = selectUnitWindow(units, offset)
  const mountedChars = window.units.reduce(
    (total, unit) => total + unit.endOffset - unit.startOffset,
    0,
  )

  assert.ok(
    window.units.some(
      (unit) => offset >= unit.startOffset && offset < unit.endOffset,
    ),
  )
  assert.ok(window.units.length <= MAX_WINDOW_UNITS)
  assert.ok(mountedChars <= MAX_WINDOW_CHARS)
  assert.equal(
    unitForOffset(units, offset),
    window.start +
      window.units.findIndex(
        (unit) => offset >= unit.startOffset && offset < unit.endOffset,
      ),
  )
})

test('spacer geometry uses measurements without changing untouched estimates', () => {
  const units = buildUnits([section(120_000)], new Map())
  const width = 720
  const fontSize = 18
  const lineHeight = 1.7
  const measured = 12_345
  const measurements = new Map([[units[1].id, measured]])
  const expected =
    estimateUnitHeight(units[0], width, fontSize, lineHeight) +
    measured +
    estimateUnitHeight(units[2], width, fontSize, lineHeight)

  assert.equal(
    spacerHeight(units, 0, 3, measurements, width, fontSize, lineHeight),
    expected,
  )
})
