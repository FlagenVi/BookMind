import { ApiError, request } from './client'
import type { ProcessingState } from '../components/ProcessingBadge'

export interface DocumentDetails {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}
export interface DocumentPreview {
  processing?: ProcessingState
  id: string
  title: string
  preview: string
  createdAt: string
}
export interface DocumentPage {
  items: DocumentPreview[]
  page: number
  totalPages: number
  totalElements: number
}
export const documentsApi = {
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ id: string; title: string }>('/documents/upload', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(120000),
    })
  },
  uploadResumable: async (
    file: File,
    onProgress: (value: number) => void,
    onSession: (id: string) => void,
    previousSession?: string,
  ) => {
    const title = file.name.replace(/\.[^.]+$/, '').trim() || 'Книга'
    let session: {
      id: string
      confirmedOffset: number
      expectedSize: number
      status: string
      documentId?: string
    }
    if (previousSession) {
      try {
        session = await request(
          `/book-uploads/${encodeURIComponent(previousSession)}`,
        )
        if (session.expectedSize !== file.size)
          throw new Error('Размер файла изменился')
      } catch (error) {
        if (!(error instanceof ApiError) || ![404, 410].includes(error.status))
          throw error
        session = await request('/book-uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, title, size: file.size }),
        })
      }
    } else {
      session = await request('/book-uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, title, size: file.size }),
      })
    }
    onSession(session.id)
    if (session.status === 'completed' && session.documentId)
      return { id: session.documentId, title }

    let offset = session.confirmedOffset
    const chunkSize = 4 * 1024 * 1024
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize)
      const chunk = await file.slice(offset, end).arrayBuffer()
      try {
        const updated = await request<{ confirmedOffset: number }>(
          `/book-uploads/${encodeURIComponent(session.id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Upload-Offset': String(offset),
            },
            body: chunk,
            signal: AbortSignal.timeout(60000),
          },
        )
        offset = updated.confirmedOffset
      } catch (error) {
        const saved = await request<{ confirmedOffset: number }>(
          `/book-uploads/${encodeURIComponent(session.id)}`,
        )
        if (saved.confirmedOffset === offset) throw error
        offset = saved.confirmedOffset
      }
      onProgress(Math.round((offset / file.size) * 100))
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    return request<{ id: string; title: string }>(
      `/book-uploads/${encodeURIComponent(session.id)}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256 }),
        signal: AbortSignal.timeout(120000),
      },
    )
  },
  preparation: (id: string, signal?: AbortSignal) =>
    request<{
      status: 'not_started' | 'queued' | 'processing' | 'ready' | 'failed'
      processedCharacters?: number
      totalCharacters?: number
      processedParts?: number
      errorMessage?: string
    }>(`/documents/${encodeURIComponent(id)}/preparation`, { signal }),
  prepare: (id: string) =>
    request<void>(`/documents/${encodeURIComponent(id)}/preparation`, {
      method: 'POST',
    }),
  list: (page: number, signal?: AbortSignal) =>
    request<DocumentPage>(`/documents?page=${page}`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    request<DocumentDetails>(`/documents/${encodeURIComponent(id)}`, {
      signal,
    }),
  create: (input: Pick<DocumentDetails, 'title' | 'content'>) =>
    request<DocumentDetails>('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
