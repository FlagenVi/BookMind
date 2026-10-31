import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { socialApi } from '../api/social'
import { readOutbox, updateOutgoing } from './outbox'
import { setSocialConnection } from './connection'

export function SocialRuntime({ userId }: { userId: string }) {
  const client = useQueryClient()
  useEffect(() => {
    let stopped = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const refresh = () => {
      for (const key of [
        'social',
        'friends',
        'friend-requests',
        'blocks',
        'public-profile',
      ])
        void client.invalidateQueries({ queryKey: [key] })
    }
    const connect = () => {
      if (stopped) return
      if (!navigator.onLine) {
        setSocialConnection('offline')
        return
      }
      setSocialConnection('connecting')
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/social/events`,
      )
      socket.onopen = () => {
        setSocialConnection('connected')
        failures = 0
      }
      socket.onmessage = refresh
      socket.onclose = () => {
        if (!stopped)
          setSocialConnection(navigator.onLine ? 'connecting' : 'offline')
        if (!stopped)
          retry = setTimeout(
            connect,
            Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)),
          )
      }
    }
    const online = () => {
      if (retry) clearTimeout(retry)
      if (socket) socket.onclose = null
      socket?.close()
      connect()
    }
    connect()
    const offline = () => setSocialConnection('offline')
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socket?.close()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [client, userId])

  useEffect(() => {
    let stopped = false
    let running = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const pump = async () => {
      if (running || stopped || !navigator.onLine) return
      running = true
      try {
        while (!stopped) {
          const item = readOutbox(userId).find((entry) => !entry.failed)
          if (!item) break
          try {
            await socialApi.send(
              item.conversationId,
              item.input,
              controller.signal,
            )
            if (stopped) break
            updateOutgoing(userId, item.input.clientId, null)
            void client.invalidateQueries({ queryKey: ['social'] })
          } catch (error) {
            if (stopped) break
            const permanent =
              error instanceof ApiError &&
              error.status !== 429 &&
              error.status >= 400 &&
              error.status < 500
            updateOutgoing(userId, item.input.clientId, {
              failed: permanent,
              error:
                error instanceof Error
                  ? error.message
                  : 'Не удалось отправить сообщение',
            })
            if (!permanent) {
              retry = setTimeout(() => void pump(), 30000)
              break
            }
          }
        }
      } finally {
        running = false
      }
    }
    const queueChanged = () => void pump()
    void pump()
    window.addEventListener('online', queueChanged)
    window.addEventListener('social-outbox', queueChanged)
    const storageChanged = (event: StorageEvent) => {
      if (event.key?.startsWith(`bookmind-outbox:${userId}:`)) void pump()
    }
    window.addEventListener('storage', storageChanged)
    return () => {
      stopped = true
      controller.abort()
      if (retry) clearTimeout(retry)
      window.removeEventListener('online', queueChanged)
      window.removeEventListener('social-outbox', queueChanged)
      window.removeEventListener('storage', storageChanged)
    }
  }, [client, userId])
  return null
}
