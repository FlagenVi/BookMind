import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_CACHE_BYTES,
  MAX_CACHED_SECTIONS,
  selectSectionEvictions,
  type SectionCacheEntry,
} from '../src/reader/sectionCache.ts'

function entries(count: number, contentLength: number) {
  return Array.from({ length: count }, (_, sectionNumber) => ({
    key: sectionNumber,
    sectionNumber,
    contentLength,
    lastAccess: sectionNumber,
    protected: sectionNumber >= count - 2,
  })) satisfies SectionCacheEntry<number>[]
}

test('LRU evicts oldest unprotected sections until the count limit is met', () => {
  const evictions = selectSectionEvictions(entries(14, 1_000))
  assert.deepEqual(
    evictions.map((entry) => entry.sectionNumber),
    [0, 1, 2, 3],
  )
  assert.equal(14 - evictions.length, MAX_CACHED_SECTIONS)
})

test('LRU also enforces the UTF-16 byte budget', () => {
  const contentLength = 600_000
  const cached = entries(9, contentLength)
  const evictions = selectSectionEvictions(cached)
  const remainingBytes = (cached.length - evictions.length) * contentLength * 2

  assert.ok(remainingBytes <= MAX_CACHE_BYTES)
  assert.ok(evictions.every((entry) => !entry.protected))
})

test('active window sections are never selected for eviction', () => {
  const cached = entries(15, 500_000)
  const evictions = selectSectionEvictions(cached)
  assert.ok(evictions.every((entry) => !entry.protected))
  assert.deepEqual(
    cached
      .filter((entry) => entry.protected)
      .map((entry) => entry.sectionNumber),
    [13, 14],
  )
})
