import { request } from './client.ts'

export type ChatPerson = { username: string | null; displayName: string | null }
export type ChatMessage = {
  id: number
  senderId: string
  mine: boolean
  body: string
  createdAt: string
  editedAt: string | null
  deleted: boolean
  reply: { id: number; author: string; text: string; deleted: boolean } | null
  bookTitle: string | null
  bookAuthor: string | null
  quote: string | null
  spoiler: boolean
}
export type Conversation = {
  id: string
  person: ChatPerson
  canSend: boolean
  unread: number
  peerReadId: number
  lastMessage: ChatMessage | null
}
export type MessageInput = {
  clientId: string
  body: string
  replyTo?: number
  bookId?: string
  startOffset?: number
  endOffset?: number
  spoiler?: boolean
}
export type NotificationPreferences = {
  messages: boolean
  friends: boolean
  paused: boolean
}
export type SocialNotice = {
  id: string
  kind: 'message' | 'friend_request' | 'friend_accepted'
  actor: ChatPerson
  conversationId: string | null
  seen: boolean
  occurredAt: string
}
const json = (
  method: string,
  body: unknown,
  signal?: AbortSignal,
): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
  signal,
})
export const socialApi = {
  conversations: (signal?: AbortSignal) =>
    request<Conversation[]>('/social/conversations', { signal }),
  conversation: (id: string, signal?: AbortSignal) =>
    request<Conversation>(`/social/conversations/${id}`, { signal }),
  open: (username: string, signal?: AbortSignal) =>
    request<Conversation>(
      '/social/conversations',
      json('POST', { username }, signal),
    ),
  messages: (id: string, before?: number, signal?: AbortSignal, query = '') =>
    request<{ items: ChatMessage[]; hasMore: boolean }>(
      `/social/conversations/${id}/messages?q=${encodeURIComponent(query)}${before ? `&before=${before}` : ''}`,
      { signal },
    ),
  send: (id: string, input: MessageInput, signal?: AbortSignal) =>
    request<ChatMessage>(
      `/social/conversations/${id}/messages`,
      json('POST', input, signal),
    ),
  edit: (id: string, message: number, body: string) =>
    request<ChatMessage>(
      `/social/conversations/${id}/messages/${message}`,
      json('PUT', { body }),
    ),
  remove: (id: string, message: number) =>
    request<void>(`/social/conversations/${id}/messages/${message}`, {
      method: 'DELETE',
    }),
  read: (id: string, lastId: number) =>
    request<void>(`/social/conversations/${id}/read`, json('POST', { lastId })),
  unread: (signal?: AbortSignal) =>
    request<{ messages: number; notifications: number }>('/social/unread', {
      signal,
    }),
  notifications: (page: number, signal?: AbortSignal, unreadOnly = false) =>
    request<{ items: SocialNotice[]; hasMore: boolean }>(
      `/social/notifications?page=${page}&unreadOnly=${unreadOnly}`,
      { signal },
    ),
  seen: (id: string) =>
    request<void>(`/social/notifications/${id}/read`, { method: 'POST' }),
  seenAll: () =>
    request<void>('/social/notifications/read-all', { method: 'POST' }),
  preferences: (signal?: AbortSignal) =>
    request<NotificationPreferences>('/social/notification-preferences', {
      signal,
    }),
  savePreferences: (input: NotificationPreferences) =>
    request<NotificationPreferences>(
      '/social/notification-preferences',
      json('PUT', input),
    ),
}

// getRandomValues works on LAN HTTP too; randomUUID requires a secure context.
export function newMessageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function messagePreview(message: ChatMessage | null) {
  if (!message) return 'Начните разговор'
  if (message.deleted) return 'Сообщение удалено'
  if (message.quote) return `Цитата из книги «${message.bookTitle}»`
  return message.body || `Книга «${message.bookTitle}»`
}
