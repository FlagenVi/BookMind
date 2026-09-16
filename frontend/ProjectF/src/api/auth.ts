import { ApiError, request } from './client'

export interface Profile {
  id: string
  email: string
  displayName: string | null
  bio: string | null
  hasAvatar: boolean
  avatarUpdatedAt: string
  createdAt: string
  documentCount: number
}
export interface UserSession {
  id: string
  browser: string
  operatingSystem: string
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET'
  createdAt: string
  lastActiveAt: string
  current: boolean
}
export interface Credentials {
  email: string
  password: string
  rememberMe?: boolean
}
export const authApi = {
  me: async (signal?: AbortSignal): Promise<Profile | null> => {
    try {
      return await request<Profile>('/auth/me', { signal })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  },
  authenticate: (mode: 'login' | 'register', input: Credentials) =>
    request<Profile>(`/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  updateProfile: (input: { displayName: string; bio: string }) =>
    request<Profile>('/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Profile>('/auth/profile/avatar', {
      method: 'POST',
      body: form,
    })
  },
  deleteAvatar: () =>
    request<Profile>('/auth/profile/avatar', { method: 'DELETE' }),
  sessions: (signal?: AbortSignal) =>
    request<UserSession[]>('/auth/sessions', { signal }),
  revokeSession: (id: string) =>
    request<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  revokeOtherSessions: () =>
    request<void>('/auth/sessions', { method: 'DELETE' }),
}
