import assert from 'node:assert/strict'
import test from 'node:test'
import {
  messagePreview,
  newMessageId,
  type ChatMessage,
} from '../src/api/social.ts'
import {
  enqueueMessage,
  readOutbox,
  updateOutgoing,
} from '../src/social/outbox.ts'

class StorageFixture {
  entries = new Map<string, string>()
  unavailable = false
  get length() {
    return this.entries.size
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.unavailable) throw new Error('Storage disabled')
    this.entries.set(key, value)
  }
  removeItem(key: string) {
    if (this.unavailable) throw new Error('Storage disabled')
    this.entries.delete(key)
  }
}
const storage = new StorageFixture()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
})
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: new EventTarget(),
})

test('LAN-compatible client identifiers remain unique version-4 UUIDs', () => {
  const ids = Array.from({ length: 100 }, newMessageId)
  assert.equal(new Set(ids).size, ids.length)
  ids.forEach((id) =>
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  )
})
test('conversation previews never disclose a hidden quote or deleted message', () => {
  const message = {
    deleted: false,
    quote: 'Секретный финал',
    body: 'Спойлер в комментарии',
    bookTitle: 'Название',
  } as ChatMessage
  assert.equal(messagePreview(message), 'Цитата из книги «Название»')
  assert.equal(
    messagePreview({ ...message, deleted: true }),
    'Сообщение удалено',
  )
})
test('persistent outbox isolates accounts and retains the request ID on retry', () => {
  const first = enqueueMessage('owner-a', 'conversation-a', { body: 'Первое' })
  const other = enqueueMessage('owner-ab', 'conversation-b', { body: 'Личное' })
  updateOutgoing('owner-a', first.input.clientId, {
    failed: true,
    error: 'Нет связи',
  })
  assert.equal(readOutbox('owner-a').length, 1)
  updateOutgoing('owner-a', first.input.clientId, {
    failed: false,
    error: undefined,
  })
  assert.equal(readOutbox('owner-a')[0].input.clientId, first.input.clientId)
  updateOutgoing('owner-a', other.input.clientId, null)
  assert.equal(readOutbox('owner-ab')[0].input.body, 'Личное')
  assert.ok(
    [...storage.entries.keys()].some((key) =>
      key.includes(first.input.clientId),
    ),
  )
  updateOutgoing('owner-a', first.input.clientId, null)
  assert.equal(readOutbox('owner-a').length, 0)
})
test('messages from another tab are not overwritten by a later enqueue', () => {
  const external = {
    conversationId: 'second',
    queuedAt: 1,
    input: { clientId: newMessageId(), body: 'Другая вкладка' },
  }
  storage.setItem(
    `bookmind-outbox:tabs:${external.input.clientId}`,
    JSON.stringify(external),
  )
  enqueueMessage('tabs', 'first', { body: 'Новая вкладка' })
  assert.equal(readOutbox('tabs').length, 2)
  assert.equal(readOutbox('tabs')[0].input.body, 'Другая вкладка')
})
test('disabled storage still permits sending from the in-memory queue', () => {
  storage.unavailable = true
  try {
    const item = enqueueMessage('volatile', 'conversation', {
      body: 'Без хранилища',
    })
    assert.equal(readOutbox('volatile')[0].input.body, 'Без хранилища')
    updateOutgoing('volatile', item.input.clientId, null)
    assert.equal(readOutbox('volatile').length, 0)
  } finally {
    storage.unavailable = false
  }
})
