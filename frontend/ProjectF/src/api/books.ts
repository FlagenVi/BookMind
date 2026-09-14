import { request } from './client'

export interface BookItem {
  id: string
  title: string
  author?: string
  format: string
  filename?: string
  createdAt: string
  textLength: number
  positionOffset: number
  preparation: string
  hasCover: boolean
  genres: string[]
  libraryStatus: LibraryStatus
  lastReadAt?: string
  readingSeconds: number
}
export type LibraryStatus = 'want_to_read' | 'reading' | 'finished'
export type LibrarySort =
  | 'recent'
  | 'added'
  | 'title'
  | 'author'
  | 'progress'
  | 'duration'
export interface BookFilters {
  q?: string
  status?: LibraryStatus | 'all'
  sort?: LibrarySort
}
export interface BookPage {
  items: BookItem[]
  page: number
  totalPages: number
  totalElements: number
}
export interface BookSection {
  number: number
  title: string
  role: 'main' | 'auxiliary'
  startOffset: number
  endOffset: number
  tocLevel: number
}
export interface BookTocEntry {
  number: number
  title: string
  role: 'main' | 'auxiliary'
  level: number
  positionOffset: number
}
export interface BookManifest {
  id: string
  title: string
  format: string
  textLength: number
  positionOffset: number
  sections: BookSection[]
  toc: BookTocEntry[]
}
export interface SectionContent extends BookSection {
  content: string
  assets: { id: string; mediaType: string }[]
}
export interface ReadingProgress {
  positionOffset: number
  confirmedOffset: number
  version: number
  readingSeconds: number
  lastReadAt?: string
  updatedAt: string
}
export interface Bookmark {
  id: string
  positionOffset: number
  label?: string
  excerpt: string
  createdAt: string
}
export interface Highlight {
  id: string
  startOffset: number
  endOffset: number
  color: 'yellow' | 'green' | 'blue' | 'pink'
  exactText: string
  note?: string
  createdAt: string
}

export const booksApi = {
  list: (page = 0, filters: BookFilters = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page) })
    if (filters.q?.trim()) params.set('q', filters.q.trim())
    if (filters.status && filters.status !== 'all')
      params.set('status', filters.status)
    if (filters.sort) params.set('sort', filters.sort)
    return request<BookPage>(`/books?${params}`, { signal })
  },
  saveLibrary: (
    id: string,
    input: { status: LibraryStatus; author?: string; genres: string[] },
  ) =>
    request<{ status: LibraryStatus; author?: string; genres: string[] }>(
      `/books/${encodeURIComponent(id)}/library`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),
  manifest: (id: string, signal?: AbortSignal) =>
    request<BookManifest>(`/books/${encodeURIComponent(id)}/manifest`, {
      signal,
    }),
  section: (id: string, number: number, signal?: AbortSignal) =>
    request<SectionContent>(
      `/books/${encodeURIComponent(id)}/sections/${number}`,
      { signal },
    ),
  content: (id: string, signal?: AbortSignal) =>
    request<SectionContent[]>(`/books/${encodeURIComponent(id)}/content`, {
      signal,
    }),
  progress: (id: string, signal?: AbortSignal) =>
    request<ReadingProgress>(`/books/${encodeURIComponent(id)}/progress`, {
      signal,
    }),
  saveProgress: (
    id: string,
    input: {
      positionOffset: number
      confirmedOffset?: number
      version?: number
      elapsedSeconds?: number
    },
  ) =>
    request<ReadingProgress>(`/books/${encodeURIComponent(id)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  bookmarks: (id: string, signal?: AbortSignal) =>
    request<Bookmark[]>(`/books/${encodeURIComponent(id)}/bookmarks`, {
      signal,
    }),
  addBookmark: (
    id: string,
    input: Pick<Bookmark, 'positionOffset' | 'excerpt'> & { label?: string },
  ) =>
    request<Bookmark>(`/books/${encodeURIComponent(id)}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  removeBookmark: (id: string, bookmarkId: string) =>
    request<void>(
      `/books/${encodeURIComponent(id)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      { method: 'DELETE' },
    ),
  highlights: (id: string, signal?: AbortSignal) =>
    request<Highlight[]>(`/books/${encodeURIComponent(id)}/highlights`, {
      signal,
    }),
  addHighlight: (id: string, input: Omit<Highlight, 'id' | 'createdAt'>) =>
    request<Highlight>(`/books/${encodeURIComponent(id)}/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  removeHighlight: (id: string, highlightId: string) =>
    request<void>(
      `/books/${encodeURIComponent(id)}/highlights/${encodeURIComponent(highlightId)}`,
      { method: 'DELETE' },
    ),
}
