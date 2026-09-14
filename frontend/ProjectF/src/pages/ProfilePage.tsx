import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { Button } from '../components/ui/button'

export function ProfilePage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await client.cancelQueries()
      client.clear()
      client.setQueryData(['me'], null)
      navigate('/auth', { replace: true })
    },
  })
  return (
    <section className="rounded-2xl border border-line bg-surface p-8">
      <h1 className="text-3xl font-semibold">Профиль</h1>
      <dl className="mt-6 space-y-4">
        <div>
          <dt className="text-sm text-muted">Email</dt>
          <dd className="break-all">{me.data?.email}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Сохранено документов</dt>
          <dd>{me.data?.documentCount}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Дата регистрации</dt>
          <dd>
            {me.data && new Date(me.data.createdAt).toLocaleDateString('ru-RU')}
          </dd>
        </div>
      </dl>
      <Button
        className="mt-8"
        variant="outline"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {logout.isPending ? 'Выход…' : 'Выйти из аккаунта'}
      </Button>
      {logout.isError && (
        <p role="alert" className="mt-3 text-danger">
          {logout.error.message}
        </p>
      )}
    </section>
  )
}
