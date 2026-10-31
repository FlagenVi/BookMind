import assert from 'node:assert/strict'
import test from 'node:test'
import { languageDisplayName } from '../src/library/bookDetailsFormat.ts'

test('standard language codes get readable Russian names', () => {
  assert.equal(languageDisplayName('ru'), 'Русский')
  assert.equal(languageDisplayName('en'), 'Английский')
})

test('language formatting preserves an original non-code value', () => {
  assert.equal(languageDisplayName('Старославянский'), 'Старославянский')
  assert.equal(languageDisplayName(null), 'Не указано')
})
