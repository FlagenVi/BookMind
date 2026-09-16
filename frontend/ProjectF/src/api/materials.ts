import { request } from './client'
import type { MaterialType } from './documents'

export type MaterialContextMode =
  | 'full_document'
  | 'selected_sections'
  | 'selected_fragment'
  | 'read_to_position'
  | 'current_chapter'
  | 'whole_book'

export interface MaterialContextSummary {
  id: string
  materialType: MaterialType
  mode: MaterialContextMode
  title: string
  startOffset: number
  endOffset: number
  positionOffset?: number | null
  progressPercent?: number | null
  sectionNumbers: number[]
  contentLength: number
  sourceSha256?: string | null
  sourceUpdatedAt: string
  createdAt: string
}

export interface MaterialContextDetails extends MaterialContextSummary {
  content: string
}

export interface CreateMaterialContext {
  mode: MaterialContextMode
  title?: string
  startOffset?: number
  endOffset?: number
  sectionNumbers?: number[]
  includeUnread?: boolean
}

export const materialsApi = {
  contexts: (materialId: string, signal?: AbortSignal) =>
    request<MaterialContextSummary[]>(
      `/materials/${encodeURIComponent(materialId)}/contexts`,
      { signal },
    ),
  context: (materialId: string, contextId: string, signal?: AbortSignal) =>
    request<MaterialContextDetails>(
      `/materials/${encodeURIComponent(materialId)}/contexts/${encodeURIComponent(contextId)}`,
      { signal },
    ),
  createContext: (materialId: string, input: CreateMaterialContext) =>
    request<MaterialContextDetails>(
      `/materials/${encodeURIComponent(materialId)}/contexts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ),
  removeContext: (materialId: string, contextId: string) =>
    request<void>(
      `/materials/${encodeURIComponent(materialId)}/contexts/${encodeURIComponent(contextId)}`,
      { method: 'DELETE' },
    ),
}
