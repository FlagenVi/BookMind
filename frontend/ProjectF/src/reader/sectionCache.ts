export const MAX_CACHED_SECTIONS = 10
export const MAX_CACHE_BYTES = 8 * 1024 * 1024

export type SectionCacheEntry<Key> = {
  key: Key
  sectionNumber: number
  contentLength: number
  lastAccess: number
  protected: boolean
}

export function selectSectionEvictions<Key>(
  entries: SectionCacheEntry<Key>[],
  maxSections = MAX_CACHED_SECTIONS,
  maxBytes = MAX_CACHE_BYTES,
) {
  let count = entries.length
  let bytes = entries.reduce(
    (total, entry) => total + entry.contentLength * 2,
    0,
  )
  const evictions: SectionCacheEntry<Key>[] = []
  const removable = entries
    .filter((entry) => !entry.protected)
    .sort((a, b) => a.lastAccess - b.lastAccess)

  for (const entry of removable) {
    if (count <= maxSections && bytes <= maxBytes) break
    evictions.push(entry)
    count--
    bytes -= entry.contentLength * 2
  }
  return evictions
}
