import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  BookSearchItem,
  Highlight,
  SectionLink,
} from '../src/api/books.ts'
import { segmentReaderText } from '../src/reader/textSegments.ts'

test('text segmentation keeps highlight, search, and internal link ranges', () => {
  const highlights: Highlight[] = [
    {
      id: 'h1',
      startOffset: 102,
      endOffset: 108,
      color: 'yellow',
      exactText: '234567',
      createdAt: '',
    },
  ]
  const searchMatches: BookSearchItem[] = [
    {
      index: 4,
      sectionNumber: 2,
      sectionOffset: 5,
      positionOffset: 105,
      length: 5,
      excerpt: 'match',
      excerptMatchStart: 0,
      excerptMatchEnd: 5,
    },
  ]
  const links: SectionLink[] = [
    {
      startOffset: 7,
      endOffset: 12,
      targetSectionNumber: 3,
      targetSectionOffset: 0,
      targetPositionOffset: 500,
      kind: 'internal',
    },
  ]
  const segments = segmentReaderText({
    text: '0123456789abcdefghij',
    baseOffset: 100,
    sectionStartOffset: 100,
    highlights,
    searchMatches,
    activeSearchIndex: 4,
    links,
  })
  assert.equal(
    segments.map((item) => item.text).join(''),
    '0123456789abcdefghij',
  )
  assert.ok(segments.some((item) => item.highlight?.id === 'h1'))
  assert.ok(segments.some((item) => item.search === 'active'))
  assert.ok(segments.some((item) => item.link?.kind === 'internal'))
  assert.deepEqual(
    segments.map((item) => [
      item.startOffset,
      item.endOffset,
      !!item.highlight,
      item.search,
      item.link?.kind ?? null,
    ]),
    [
      [100, 102, false, null, null],
      [102, 105, true, null, null],
      [105, 107, true, 'active', null],
      [107, 108, true, 'active', 'internal'],
      [108, 110, false, 'active', 'internal'],
      [110, 112, false, null, 'internal'],
      [112, 120, false, null, null],
    ],
  )
})
