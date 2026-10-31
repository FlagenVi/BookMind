import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('reader API never references the legacy whole-book /content endpoint', async () => {
  const apiSource = await readFile(
    new URL('../src/api/books.ts', import.meta.url),
    'utf8',
  )
  const readerSources = await Promise.all(
    [
      '../src/pages/ReaderPage.tsx',
      '../src/reader/useContinuousReader.ts',
      '../src/reader/ContinuousReader.tsx',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  )

  assert.match(apiSource, /\/sections\/\$\{number\}/)
  assert.match(apiSource, /\/search\?\$\{params\}/)
  assert.match(apiSource, /links\?: SectionLink\[\]/)
  assert.doesNotMatch(
    [apiSource, ...readerSources].join('\n'),
    /\/content[`'"]/,
  )
})
