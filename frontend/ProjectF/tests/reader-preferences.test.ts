import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultReaderPreferences,
  readReaderPreferences,
  writeReaderPreferences,
} from '../src/reader/preferences.ts'

function storage(initial?: string) {
  let value = initial ?? null
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next
      },
    },
  })
  return () => value
}

test('reader preferences reject unknown values and clamp numeric settings', () => {
  storage(
    JSON.stringify({
      mode: 'broken',
      theme: 'night',
      font: 'sans',
      fontSize: 99,
      lineHeight: 0.5,
      width: 5000,
    }),
  )
  assert.deepEqual(readReaderPreferences(), {
    mode: defaultReaderPreferences.mode,
    theme: 'night',
    font: 'sans',
    fontSize: 34,
    lineHeight: 1.3,
    width: 1100,
  })
})

test('reader preferences round trip through browser storage', () => {
  const current = storage()
  const preferences = {
    ...defaultReaderPreferences,
    mode: 'spread' as const,
    fontSize: 24,
  }
  writeReaderPreferences(preferences)
  assert.ok(current()?.includes('"fontSize":24'))
  assert.deepEqual(readReaderPreferences(), preferences)
})
