import { useEffect, useState } from 'react'
import { newMessageId, type MessageInput } from '../api/social.ts'

export type OutgoingMessage = {
  queuedAt: number
  conversationId: string
  input: MessageInput
  preview?: string
  error?: string
  failed?: boolean
}
const volatile = new Map<string, Map<string, OutgoingMessage>>()
const key = (user: string) => `bookmind-outbox:${user}:`
export function readOutbox(user: string): OutgoingMessage[] {
  const items = new Map<string, OutgoingMessage>()
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storageKey = localStorage.key(index)
      if (!storageKey?.startsWith(key(user))) continue
      try {
        const item = JSON.parse(localStorage.getItem(storageKey) || 'null')
        if (
          item &&
          typeof item.conversationId === 'string' &&
          typeof item.input?.clientId === 'string' &&
          typeof item.input?.body === 'string'
        )
          items.set(item.input.clientId, item)
      } catch {
        /* Ignore a single damaged queue entry. */
      }
    }
  } catch {
    /* Storage may be disabled by the browser. */
  }
  volatile.get(user)?.forEach((item, id) => items.set(id, item))
  return [...items.values()].sort((a, b) => a.queuedAt - b.queuedAt)
}
function persist(user: string, id: string, value: OutgoingMessage | null) {
  try {
    if (value) localStorage.setItem(key(user) + id, JSON.stringify(value))
    else localStorage.removeItem(key(user) + id)
    volatile.get(user)?.delete(id)
  } catch {
    if (!volatile.has(user)) volatile.set(user, new Map())
    if (value) volatile.get(user)!.set(id, value)
    else volatile.get(user)!.delete(id)
  }
  window.dispatchEvent(new CustomEvent('social-outbox', { detail: user }))
}
export function enqueueMessage(
  user: string,
  conversationId: string,
  input: Omit<MessageInput, 'clientId'>,
  preview?: string,
) {
  const queue = readOutbox(user)
  if (queue.length >= 50)
    throw new Error(
      'В очереди уже 50 сообщений. Дождитесь отправки или удалите ненужные.',
    )
  const item = {
    queuedAt: Date.now(),
    conversationId,
    input: { ...input, clientId: newMessageId() },
    preview,
  }
  persist(user, item.input.clientId, item)
  return item
}
export function updateOutgoing(
  user: string,
  id: string,
  update: Partial<OutgoingMessage> | null,
) {
  const item = readOutbox(user).find((entry) => entry.input.clientId === id)
  if (item) persist(user, id, update ? { ...item, ...update } : null)
}
export function useOutbox(user: string) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const update = () => setRevision((value) => value + 1)
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith(key(user))) update()
    }
    window.addEventListener('social-outbox', update)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener('social-outbox', update)
      window.removeEventListener('storage', storage)
    }
  }, [user])
  void revision
  return readOutbox(user)
}
