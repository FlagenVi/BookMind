import { request } from './client'

export interface Person {
  username: string
  displayName: string | null
  hasAvatar: boolean
}
export interface PublicBook {
  id: string
  title: string
  author: string | null
  hasCover: boolean
}
export interface PublicProfile {
  username: string
  displayName: string | null
  bio: string | null
  hasAvatar: boolean
  visibility: 'public' | 'friends' | 'private'
  relationship: 'none' | 'self' | 'incoming' | 'outgoing' | 'friends'
  favoriteGenres: string[]
  featuredBooks: PublicBook[]
  statistics: { readingMinutes: number; booksFinished: number } | null
  activity: Array<{ date: string; minutes: number }>
  friends: Person[]
  libraryVisible: boolean
  statisticsVisible: boolean
  activityVisible: boolean
  friendsVisible: boolean
}
export interface FriendRequest extends Person {
  incoming: boolean
}

export const profilesApi = {
  search: (q: string, signal?: AbortSignal) =>
    request<Person[]>(`/profiles/search?q=${encodeURIComponent(q)}`, { signal }),
  get: (username: string, signal?: AbortSignal) =>
    request<PublicProfile>(`/profiles/${encodeURIComponent(username)}`, { signal }),
  books: (username: string, page: number, signal?: AbortSignal) =>
    request<PublicBook[]>(`/profiles/${encodeURIComponent(username)}/books?page=${page}`, { signal }),
  friends: (signal?: AbortSignal) => request<Person[]>('/friends', { signal }),
  requests: (signal?: AbortSignal) => request<FriendRequest[]>('/friends/requests', { signal }),
  sendRequest: (username: string) =>
    request<void>(`/friends/${encodeURIComponent(username)}/request`, { method: 'POST' }),
  accept: (username: string) =>
    request<void>(`/friends/${encodeURIComponent(username)}/accept`, { method: 'POST' }),
  remove: (username: string) =>
    request<void>(`/friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  blocks: (signal?: AbortSignal) => request<Person[]>('/blocks', { signal }),
  block: (username: string) =>
    request<void>(`/blocks/${encodeURIComponent(username)}`, { method: 'POST' }),
  unblock: (username: string) =>
    request<void>(`/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' }),
}
