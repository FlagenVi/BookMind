import { ApiError, request } from './client'

export interface Profile {
  id: string
  email: string
  createdAt: string
  documentCount: number
}
export interface Credentials {
  email: string
  password: string
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
}
