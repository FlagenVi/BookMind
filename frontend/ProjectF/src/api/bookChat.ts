import { request } from './client'

export type BookChatMode = 'grounded' | 'model_knowledge'

export interface BookChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface BookChatReference {
  sectionNumber: number
  title: string
  startOffset: number
  endOffset: number
}

export interface BookChatTurn {
  id: string
  mode: BookChatMode
  question: string
  answer: string | null
  status: 'pending' | 'ready' | 'failed'
  errorMessage: string | null
  positionOffset: number | null
  sourceSha256: string | null
  sourceUpdatedAt: string | null
  references: BookChatReference[]
  promptTokens: number
  completionTokens: number
  createdAt: string
}

const path = (bookId: string) => `/books/${encodeURIComponent(bookId)}/chats`

export const bookChatApi = {
  threads: (bookId: string, signal?: AbortSignal) =>
    request<BookChatThread[]>(path(bookId), { signal }),
  create: (bookId: string) =>
    request<BookChatThread>(path(bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
  remove: (bookId: string, threadId: string) =>
    request<void>(`${path(bookId)}/${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
    }),
  turns: (bookId: string, threadId: string, signal?: AbortSignal) =>
    request<BookChatTurn[]>(
      `${path(bookId)}/${encodeURIComponent(threadId)}/turns`,
      { signal },
    ),
  send: (
    bookId: string,
    threadId: string,
    input: { id: string; question: string; mode: BookChatMode },
  ) =>
    request<BookChatTurn>(
      `${path(bookId)}/${encodeURIComponent(threadId)}/turns`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(150_000),
      },
    ),
}
