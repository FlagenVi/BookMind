import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'

/** Ends the server session and drops every cached query so no data of the previous user remains. */
export function useLogout() {
  const client = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await client.cancelQueries()
      client.clear()
      client.setQueryData(['me'], null)
      navigate('/auth', { replace: true })
    },
  })
}
