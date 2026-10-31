// Opens the reader with the spoiler-free summary panel, the "remember what I read" scenario.
export function recallPath(bookId: string) {
  return `/library/${encodeURIComponent(bookId)}/read?panel=book&tab=summary`
}

export function readingProgress(positionOffset: number, textLength: number) {
  return textLength
    ? Math.min(100, Math.round((positionOffset * 100) / textLength))
    : 0
}
