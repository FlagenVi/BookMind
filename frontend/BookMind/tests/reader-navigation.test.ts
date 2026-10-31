import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chapterStartOffset,
  completedChapterOnAdvance,
  confirmedOffsetAfter,
  historyAnchorAtOffset,
  parseJumpTarget,
  parseSidebarTab,
  pushHistoryAnchor,
  type HistoryAnchor,
} from '../src/reader/navigationState.ts'
import { offsetFromAnchor } from '../src/reader/textAnchors.ts'

const anchor = (positionOffset: number): HistoryAnchor => ({
  positionOffset,
  sectionNumber: 1,
  sectionOffset: positionOffset,
  source: 'toc',
})

test('unknown persisted sidebar tab falls back to contents', () => {
  assert.equal(parseSidebarTab('search'), 'search')
  assert.equal(parseSidebarTab('unknown'), 'toc')
  assert.equal(parseSidebarTab(null), 'toc')
})

test('navigation history removes close duplicates and respects its limit', () => {
  assert.equal(pushHistoryAnchor([anchor(100)], anchor(140)).length, 1)
  const history = Array.from({ length: 45 }, (_, index) => anchor(index * 100))
  assert.equal(pushHistoryAnchor(history, anchor(5_000)).length, 40)
  assert.equal(pushHistoryAnchor(history, anchor(5_000))[0].positionOffset, 600)
})

test('navigation history restores the last place first with a stable anchor', () => {
  const originalSections = [
    {
      number: 1,
      title: 'Глава',
      role: 'main' as const,
      startOffset: 1_000,
      endOffset: 2_000,
      tocLevel: 0,
    },
  ]
  const history = pushHistoryAnchor(
    [],
    historyAnchorAtOffset(1_450, originalSections, 2_000, 'search'),
  )
  const previous = history.at(-1)
  const remaining = history.slice(0, -1)
  const shiftedSections = [
    { ...originalSections[0], startOffset: 5_000, endOffset: 6_000 },
  ]

  assert.ok(previous)
  assert.equal(offsetFromAnchor(previous, shiftedSections, 6_000), 5_450)
  assert.equal(remaining.length, 0)
})

test('programmatic navigation preserves confirmed reading progress', () => {
  assert.equal(confirmedOffsetAfter(1_000, 90_000, 'programmatic'), 1_000)
  assert.equal(confirmedOffsetAfter(1_000, 1_500, 'user'), 1_500)
})

test('chapter link opens the selected main section and ignores invalid targets', () => {
  const sections = [
    { number: 0, role: 'main', startOffset: 0 },
    { number: 1, role: 'main', startOffset: 500 },
    { number: 2, role: 'auxiliary', startOffset: 900 },
  ] as Parameters<typeof chapterStartOffset>[1]
  assert.equal(chapterStartOffset('1', sections), 500)
  assert.equal(chapterStartOffset('2', sections), null)
  assert.equal(chapterStartOffset('missing', sections), null)
  assert.equal(chapterStartOffset(null, sections), null)
})

test('only reading forward into the next chapter completes the previous chapter', () => {
  const sections = [
    { number: 0, role: 'main', startOffset: 0, endOffset: 100 },
    { number: 1, role: 'main', startOffset: 102, endOffset: 200 },
    { number: 2, role: 'main', startOffset: 202, endOffset: 300 },
  ] as Parameters<typeof completedChapterOnAdvance>[3]
  assert.equal(completedChapterOnAdvance(60, 102, 'user', sections, 300), 0)
  assert.equal(completedChapterOnAdvance(60, 102, 'programmatic', sections, 300), null)
  assert.equal(completedChapterOnAdvance(60, 202, 'user', sections, 300), null)
  assert.equal(completedChapterOnAdvance(160, 102, 'user', sections, 300), null)
})

test('percent and offset jump values are validated', () => {
  assert.deepEqual(parseJumpTarget('percent', '25', 20_000), {
    offset: 5_000,
  })
  assert.ok(parseJumpTarget('percent', '101', 20_000).error)
  assert.ok(parseJumpTarget('offset', '20001', 20_000).error)
  assert.ok(parseJumpTarget('offset', '12.5', 20_000).error)
  assert.deepEqual(parseJumpTarget('percent', '12,5', 20_000), {
    offset: 2_500,
  })
  assert.deepEqual(parseJumpTarget('percent', '0', 20_000), { offset: 0 })
  assert.deepEqual(parseJumpTarget('percent', '100', 20_000), {
    offset: 20_000,
  })
  assert.ok(parseJumpTarget('offset', '-1', 20_000).error)
})
