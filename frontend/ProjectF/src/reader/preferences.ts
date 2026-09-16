export type ReaderMode = 'scroll' | 'page' | 'spread'
export type ReaderTheme = 'paper' | 'sepia' | 'night'
export type ReaderFont = 'serif' | 'sans'

export type ReaderPreferences = {
  mode: ReaderMode
  theme: ReaderTheme
  font: ReaderFont
  fontSize: number
  lineHeight: number
  width: number
}

export const defaultReaderPreferences: ReaderPreferences = {
  mode: 'scroll',
  theme: 'paper',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.7,
  width: 760,
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function readReaderPreferences(): ReaderPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem('reader-preferences') ?? '{}')
    return {
      mode: ['scroll', 'page', 'spread'].includes(saved.mode)
        ? saved.mode
        : defaultReaderPreferences.mode,
      theme: ['paper', 'sepia', 'night'].includes(saved.theme)
        ? saved.theme
        : defaultReaderPreferences.theme,
      font: ['serif', 'sans'].includes(saved.font)
        ? saved.font
        : defaultReaderPreferences.font,
      fontSize: bounded(
        saved.fontSize,
        defaultReaderPreferences.fontSize,
        14,
        34,
      ),
      lineHeight: bounded(
        saved.lineHeight,
        defaultReaderPreferences.lineHeight,
        1.3,
        2.2,
      ),
      width: bounded(saved.width, defaultReaderPreferences.width, 520, 1100),
    }
  } catch {
    return defaultReaderPreferences
  }
}

export function writeReaderPreferences(value: ReaderPreferences) {
  try {
    localStorage.setItem('reader-preferences', JSON.stringify(value))
  } catch {
    // Preferences remain active in memory when browser storage is unavailable.
  }
}
