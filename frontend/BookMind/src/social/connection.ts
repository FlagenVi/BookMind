import { useSyncExternalStore } from 'react'

type ConnectionState = 'connecting' | 'connected' | 'offline'
let state: ConnectionState = 'connecting'
const subscribers = new Set<() => void>()
export function setSocialConnection(value: ConnectionState) {
  state = value
  subscribers.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}
export function useSocialConnection() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => 'connecting' as ConnectionState,
  )
}
