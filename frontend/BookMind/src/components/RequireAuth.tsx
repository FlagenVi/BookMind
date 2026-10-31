import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { Button } from './ui/button'

export function RequireAuth({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  useEffect(() => {
    const expire = () => {
      client.setQueryData(['me'], null)
      client.removeQueries({ queryKey: ['documents'] })
    }
    window.addEventListener('session-expired', expire)
    return () => window.removeEventListener('session-expired', expire)
  }, [client])
  if (me.isPending) return <p role="status">Проверка входа…</p>
  if (me.isError)
    return (
      <div role="alert">
        <p>{me.error.message}</p>
        <Button className="mt-4" onClick={() => void me.refetch()}>
          Повторить
        </Button>
      </div>
    )
  if (!me.data) return <Navigate to="/auth" replace />
  return children
}
