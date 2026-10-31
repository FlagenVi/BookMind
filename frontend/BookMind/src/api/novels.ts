import { request } from './client'

export interface NovelChapter {
  id: string
  number: number
  title: string
  filename: string
  format: string
  characters: number
  createdAt: string
  read: boolean
}

export interface NovelPreviewChapter {
  key: string
  title: string
  filename: string
  format: string
  characters: number
}

export interface NovelResult {
  id: string
  chapters: NovelChapter[]
}

function filesBody(files: File[], chapters?: NovelPreviewChapter[]) {
  const body = new FormData()
  files.forEach((file) => body.append('files', file))
  if (chapters)
    body.append(
      'layout',
      JSON.stringify({
        chapters: chapters.map(({ key, title }) => ({ key, title })),
      }),
    )
  return body
}

export const novelsApi = {
  preview: (files: File[]) =>
    request<{ chapters: NovelPreviewChapter[] }>('/novels/preview', {
      method: 'POST',
      body: filesBody(files),
      signal: AbortSignal.timeout(120000),
    }),
  create: (
    title: string,
    author: string,
    files: File[],
    chapters: NovelPreviewChapter[],
  ) => {
    const body = filesBody(files, chapters)
    body.append('title', title)
    if (author.trim()) body.append('author', author)
    return request<NovelResult>('/novels', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(120000),
    })
  },
  chapters: (id: string, signal?: AbortSignal) =>
    request<NovelChapter[]>(`/novels/${encodeURIComponent(id)}/chapters`, {
      signal,
    }),
  add: (
    id: string,
    files: File[],
    chapters: NovelPreviewChapter[],
    insertAt: number,
  ) => {
    const body = filesBody(files, chapters)
    body.append('insertAt', String(insertAt))
    return request<NovelResult>(
      `/novels/${encodeURIComponent(id)}/chapters`,
      {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(120000),
      },
    )
  },
  reorder: (id: string, chapters: NovelChapter[]) =>
    request<NovelResult>(
      `/novels/${encodeURIComponent(id)}/chapters/order`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapters: chapters.map(({ id: chapterId, title }) => ({
            id: chapterId,
            title,
          })),
        }),
      },
    ),
  markRead: (id: string, chapterId: string, read: boolean) =>
    request<NovelChapter>(`/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/read`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read }),
    }),
  complete: (id: string, number: number) =>
    request<NovelChapter>(`/novels/${encodeURIComponent(id)}/chapters/number/${number}/complete`, {
      method: 'POST',
    }),
  remove: (id: string, chapterId: string) =>
    request<NovelResult>(`/novels/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: 'DELETE',
    }),
}
