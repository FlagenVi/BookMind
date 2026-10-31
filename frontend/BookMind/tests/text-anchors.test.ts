import assert from 'node:assert/strict'
import test from 'node:test'
import type { BookSection } from '../src/api/books.ts'
import {
  anchorFromOffset,
  offsetFromAnchor,
  sectionForOffset,
} from '../src/reader/textAnchors.ts'

const sections: BookSection[] = [
  { number: 10, title: 'Первая', startOffset: 0, endOffset: 1_000 },
  { number: 20, title: 'Вторая', startOffset: 1_000, endOffset: 3_500 },
  { number: 30, title: 'Третья', startOffset: 3_500, endOffset: 5_000 },
]

test('anchor records section-local offset and clamps the global position', () => {
  assert.deepEqual(anchorFromOffset(2_345, sections, 5_000), {
    positionOffset: 2_345,
    sectionNumber: 20,
    sectionOffset: 1_345,
  })
  assert.equal(anchorFromOffset(8_000, sections, 5_000).positionOffset, 5_000)
})

test('far position restores by stable section when earlier text changes', () => {
  const anchor = anchorFromOffset(4_200, sections, 5_000)
  const shifted: BookSection[] = [
    { number: 10, title: 'Первая', startOffset: 0, endOffset: 50_000 },
    { number: 20, title: 'Вторая', startOffset: 50_000, endOffset: 52_500 },
    { number: 30, title: 'Третья', startOffset: 52_500, endOffset: 54_000 },
  ]

  assert.equal(offsetFromAnchor(anchor, shifted, 54_000), 53_200)
})

test('missing section falls back to the bounded global position', () => {
  assert.equal(
    offsetFromAnchor(
      { positionOffset: 4_200, sectionNumber: 99, sectionOffset: 700 },
      sections,
      5_000,
    ),
    4_200,
  )
})

test('section lookup handles exact boundaries and the final offset', () => {
  assert.equal(sectionForOffset(sections, 1_000)?.number, 20)
  assert.equal(sectionForOffset(sections, 5_000)?.number, 30)
})
