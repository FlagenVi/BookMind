import { request } from './client'

export interface BookItem {
  id: string
  title: string
  author?: string
  format: string
  filename?: string
  fileSizeBytes?: number | null
  createdAt: string
  updatedAt: string
  textLength: number
  positionOffset: number
  preparation: string
  hasCover: boolean
  favorite: boolean
  collectionId?: string | null
  genres: string[]
  libraryStatus: LibraryStatus
  lastReadAt?: string
  readingSeconds: number
}
export type LibraryStatus = 'want_to_read' | 'reading' | 'finished'
export type LibrarySort =
  'recent' | 'added' | 'title' | 'author' | 'progress' | 'duration' | 'size'
export type SortDirection = 'default' | 'asc' | 'desc'
export interface BookFilters {
  q?: string
  status?: LibraryStatus | 'all'
  format?: string
  genre?: string
  favorite?: 'all' | 'yes'
  collection?: string
  sort?: LibrarySort
  direction?: SortDirection
}
export interface LibraryFacets {
  formats: string[]
  genres: string[]
}
export interface BookCollection {
  id: string
  name: string
  bookCount: number
  createdAt: string
  updatedAt: string
}
export interface BookPage {
  items: BookItem[]
  page: number
  totalPages: number
  totalElements: number
}
export interface BookDetails {
  id: string
  title: string
  author: string | null
  genres: string[]
  format: string
  filename: string | null
  fileSizeBytes: number | null
  publisher: string | null
  publicationDate: string | null
  language: string | null
  description: string | null
  createdAt: string
  updatedAt: string
  hasCover: boolean
  favorite: boolean
  collectionId: string | null
  originalSha256: string | null
  textLength: number
  sectionCount: number
  assetCount: number
  preparationStatus: string
  processedCharacters: number | null
  totalCharacters: number | null
  importError: string | null
}
export type BookDetailsInput = Pick<BookDetails, 'title' | 'genres'> & {
  author: string | null
  publisher: string | null
  publicationDate: string | null
  language: string | null
  description: string | null
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
export interface SectionContent {
  content: string
  assets: { id: string; mediaType: string }[]
  links?: SectionLink[]
}
export interface SectionLink {
  startOffset: number
  endOffset: number
  targetSectionNumber: number
  targetSectionOffset: number
  targetPositionOffset: number
  kind: 'internal' | 'note'
}
export interface BookSearchItem {
  index: number
  sectionNumber: number
  sectionOffset: number
  positionOffset: number
  length: number
  excerpt: string
  excerptMatchStart: number
  excerptMatchEnd: number
}
export interface BookSearchPage {
  query: string
  items: BookSearchItem[]
  offset: number
  limit: number
  total: number
}
export interface ReadingProgress {
  positionOffset: number
  confirmedOffset: number
  version: number
  sectionNumber?: number | null
  sectionOffset: number
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
  updatedAt: string
}
export interface Highlight {
  id: string
  startOffset: number
  endOffset: number
  color: 'yellow' | 'green' | 'blue' | 'pink'
  exactText: string
  note?: string
  createdAt: string
  updatedAt: string
}

export const booksApi = {
  list: (page = 0, filters: BookFilters = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page) })
    if (filters.q?.trim()) params.set('q', filters.q.trim())
    if (filters.status && filters.status !== 'all')
      params.set('status', filters.status)
    if (filters.format && filters.format !== 'all')
      params.set('format', filters.format)
    if (filters.genre?.trim()) params.set('genre', filters.genre.trim())
    if (filters.favorite === 'yes') params.set('favorite', 'yes')
    if (filters.collection && filters.collection !== 'all')
      params.set('collection', filters.collection)
    if (filters.sort) params.set('sort', filters.sort)
    if (filters.direction && filters.direction !== 'default')
      params.set('direction', filters.direction)
    return request<BookPage>(`/books?${params}`, { signal })
  },
  facets: (signal?: AbortSignal) =>
    request<LibraryFacets>('/books/facets', { signal }),
  collections: (signal?: AbortSignal) =>
    request<BookCollection[]>('/books/collections', { signal }),
  createCollection: (name: string) =>
    request<BookCollection>('/books/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  renameCollection: (id: string, name: string) =>
    request<BookCollection>(`/books/collections/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  removeCollection: (id: string) =>
    request<void>(`/books/collections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  moveToCollection: (ids: string[], collectionId: string | null) =>
    request<void>('/books/bulk-collection', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, collectionId }),
    }),
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
  remove: (id: string) =>
    request<void>(`/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  saveFavorite: (id: string, favorite: boolean) =>
    request<void>(`/books/${encodeURIComponent(id)}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite }),
    }),
  bulkStatus: (ids: string[], status: LibraryStatus) =>
    request<void>('/books/bulk-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    }),
  details: (id: string, signal?: AbortSignal) =>
    request<BookDetails>(`/books/${encodeURIComponent(id)}/details`, {
      signal,
    }),
  updateDetails: (id: string, input: BookDetailsInput) =>
    request<BookDetails>(`/books/${encodeURIComponent(id)}/details`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  refreshDetails: (id: string) =>
    request<BookDetails>(`/books/${encodeURIComponent(id)}/details/refresh`, {
      method: 'POST',
    }),
  updateCover: (id: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<BookDetails>(`/books/${encodeURIComponent(id)}/cover`, {
      method: 'PUT',
      body,
    })
  },
  originalDownloadUrl: (id: string) =>
    `/api/books/${encodeURIComponent(id)}/original?download=true`,
  manifest: (id: string, signal?: AbortSignal) =>
    request<BookManifest>(`/books/${encodeURIComponent(id)}/manifest`, {
      signal,
    }),
  section: (id: string, number: number, signal?: AbortSignal) =>
    request<SectionContent>(
      `/books/${encodeURIComponent(id)}/sections/${number}`,
      { signal },
    ),
  search: (
    id: string,
    query: string,
    offset = 0,
    limit = 20,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      q: query,
      offset: String(offset),
      limit: String(limit),
    })
    return request<BookSearchPage>(
      `/books/${encodeURIComponent(id)}/search?${params}`,
      { signal },
    )
  },
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
      sectionNumber?: number | null
      sectionOffset?: number
      elapsedSeconds?: number
      sessionId?: string
      sessionElapsedSeconds?: number
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
  updateBookmark: (id: string, bookmarkId: string, label?: string) =>
    request<Bookmark>(
      `/books/${encodeURIComponent(id)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      },
    ),
  removeBookmark: (id: string, bookmarkId: string) =>
    request<void>(
      `/books/${encodeURIComponent(id)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      { method: 'DELETE' },
    ),
  highlights: (id: string, signal?: AbortSignal) =>
    request<Highlight[]>(`/books/${encodeURIComponent(id)}/highlights`, {
      signal,
    }),
  addHighlight: (
    id: string,
    input: Pick<Highlight, 'startOffset' | 'endOffset' | 'color'> & {
      exactText?: string
      note?: string
    },
  ) =>
    request<Highlight>(`/books/${encodeURIComponent(id)}/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateHighlight: (
    id: string,
    highlightId: string,
    input: Pick<Highlight, 'color'> & { note?: string },
  ) =>
    request<Highlight>(
      `/books/${encodeURIComponent(id)}/highlights/${encodeURIComponent(highlightId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),
  removeHighlight: (id: string, highlightId: string) =>
    request<void>(
      `/books/${encodeURIComponent(id)}/highlights/${encodeURIComponent(highlightId)}`,
      { method: 'DELETE' },
    ),
  annotationsExportUrl: (id: string) =>
    `/api/books/${encodeURIComponent(id)}/annotations/export`,
}
