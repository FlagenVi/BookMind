import { ApiError, request } from './client'
import type { ProcessingState } from '../components/ProcessingBadge'
import {
  findUploadSession,
  removeUploadSession,
  saveUploadSession,
  uploadFingerprint,
} from '../uploads/uploadSessions'

export interface DocumentDetails {
  id: string
  title: string
  content: string
  materialType: MaterialType
  sourceType: string
  originalFilename?: string | null
  createdAt: string
  updatedAt: string
  sections: MaterialSection[]
}
export type MaterialType = 'BOOK' | 'DOCUMENT'
export interface MaterialSection {
  number: number
  title: string
  role: 'main' | 'auxiliary'
  startOffset: number
  endOffset: number
}
export interface DocumentPreview {
  processing?: ProcessingState
  id: string
  title: string
  preview: string
  sourceType: string
  originalFilename?: string | null
  fileSizeBytes?: number | null
  pageCount?: number | null
  createdAt: string
  updatedAt: string
}
export interface DocumentPage {
  items: DocumentPreview[]
  page: number
  totalPages: number
  totalElements: number
}

export interface DocumentListFilters {
  q: string
  format: string
  sort: 'updated' | 'created' | 'title' | 'size'
  direction: 'asc' | 'desc'
}

export interface ImportReport {
  importedSections: number
  expectedSpineItems: number
  importedSpineItems: number
  importedImages: number
  missingImages: number
  skippedTocEntries: number
  metadataWarnings: string[]
}

export interface UploadSession {
  id: string
  confirmedOffset: number
  expectedSize: number
  status: 'uploading' | 'queued' | 'importing' | 'completed' | 'failed'
  documentId?: string | null
  materialType: MaterialType
  importProgress: number
  errorMessage?: string | null
  report: ImportReport
}

export interface UploadCallbacks {
  onTransfer: (value: number) => void
  onSession: (id: string) => void
  onImport: (session: UploadSession) => void
}

const pause = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export const documentsApi = {
  upload: (file: File, materialType: MaterialType = 'DOCUMENT') => {
    const body = new FormData()
    body.append('file', file)
    body.append('materialType', materialType)
    return request<{ id: string; title: string; materialType: MaterialType }>(
      '/documents/upload',
      {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(120000),
      },
    )
  },
  uploadResumable: async (
    file: File,
    materialType: MaterialType,
    callbacks: UploadCallbacks,
  ) => {
    const title = file.name.replace(/\.[^.]+$/, '').trim() || 'Книга'
    const saved = await findUploadSession(file, materialType).catch(
      () => undefined,
    )
    let session: UploadSession
    if (saved?.sessionId) {
      try {
        session = await request<UploadSession>(
          `/book-uploads/${encodeURIComponent(saved.sessionId)}`,
        )
        if (
          session.expectedSize !== file.size ||
          session.materialType !== materialType
        )
          throw new Error('Файл или выбранный тип материала изменился')
      } catch (error) {
        if (!(error instanceof ApiError) || ![404, 410].includes(error.status))
          throw error
        session = await request<UploadSession>('/book-uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            title,
            size: file.size,
            materialType,
          }),
        })
      }
    } else {
      session = await request<UploadSession>('/book-uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          title,
          size: file.size,
          materialType,
        }),
      })
    }
    callbacks.onSession(session.id)
    const persist = async (value: UploadSession, transferProgress: number) =>
      saveUploadSession({
        fingerprint: uploadFingerprint(file, materialType),
        sessionId: value.id,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        materialType,
        confirmedOffset: value.confirmedOffset,
        transferProgress,
        importProgress: value.importProgress,
        status: value.status,
        updatedAt: Date.now(),
      }).catch(() => undefined)
    await persist(
      session,
      Math.round((session.confirmedOffset / file.size) * 100),
    )

    if (session.status === 'completed' && session.documentId) {
      await removeUploadSession(file, materialType).catch(() => undefined)
      return {
        id: session.documentId,
        title,
        materialType: session.materialType,
      }
    }

    if (session.status === 'failed') {
      session = await request<UploadSession>(
        `/book-uploads/${encodeURIComponent(session.id)}/retry`,
        { method: 'POST' },
      )
    }

    let offset = session.confirmedOffset
    callbacks.onTransfer(Math.round((offset / file.size) * 100))
    const chunkSize = 4 * 1024 * 1024
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize)
      const chunk = await file.slice(offset, end).arrayBuffer()
      try {
        const updated = await request<UploadSession>(
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
        const saved = await request<UploadSession>(
          `/book-uploads/${encodeURIComponent(session.id)}`,
        )
        if (saved.confirmedOffset === offset) throw error
        offset = saved.confirmedOffset
      }
      const transferProgress = Math.round((offset / file.size) * 100)
      callbacks.onTransfer(transferProgress)
      await persist({ ...session, confirmedOffset: offset }, transferProgress)
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    session = await request<UploadSession>(
      `/book-uploads/${encodeURIComponent(session.id)}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256 }),
        signal: AbortSignal.timeout(120000),
      },
    )
    callbacks.onImport(session)
    await persist(session, 100)

    const deadline = Date.now() + 20 * 60 * 1000
    while (!['completed', 'failed'].includes(session.status)) {
      if (Date.now() >= deadline)
        throw new Error(
          'Импорт продолжается на сервере. Вернитесь к загрузке позднее.',
        )
      await pause(700)
      session = await request<UploadSession>(
        `/book-uploads/${encodeURIComponent(session.id)}`,
      )
      callbacks.onImport(session)
      await persist(session, 100)
    }
    if (session.status === 'failed')
      throw new Error(
        session.errorMessage ??
          'Не удалось импортировать файл. Нажмите «Повторить».',
      )
    if (!session.documentId)
      throw new Error('Сервер завершил импорт без созданного материала')
    await removeUploadSession(file, materialType).catch(() => undefined)
    return {
      id: session.documentId,
      title,
      materialType: session.materialType,
      report: session.report,
    }
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
  list: (page: number, signal?: AbortSignal, filters?: DocumentListFilters) => {
    const params = new URLSearchParams({ page: String(page) })
    if (filters) {
      if (filters.q.trim()) params.set('q', filters.q.trim())
      if (filters.format !== 'all') params.set('format', filters.format)
      if (filters.sort !== 'updated') params.set('sort', filters.sort)
      if (filters.direction !== 'desc') params.set('direction', filters.direction)
    }
    return request<DocumentPage>(`/documents?${params}`, { signal })
  },
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
