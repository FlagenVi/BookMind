import { useQuery } from '@tanstack/react-query'
import { socialApi } from '../api/social'

export function useSocialUnread(enabled: boolean) {
  return useQuery({
    queryKey: ['social', 'unread'],
    queryFn: ({ signal }) => socialApi.unread(signal),
    enabled,
    refetchInterval: 30000,
  })
}
