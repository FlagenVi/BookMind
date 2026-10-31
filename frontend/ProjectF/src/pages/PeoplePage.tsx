import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Search, UserPlus, Users } from 'lucide-react'
import { authApi } from '../api/auth'
import { profilesApi, type Person } from '../api/profiles'
import { Button } from '../components/ui/button'

function PersonLink({ person }: { person: Person }) {
  return (
    <Link
      to={`/people/${encodeURIComponent(person.username)}`}
      className="flex min-h-11 min-w-0 flex-1 items-center text-sm font-medium text-foreground hover:text-accent"
    >
      <span className="truncate">
        {person.displayName || person.username}{' '}
        <span className="font-normal text-muted">@{person.username}</span>
      </span>
    </Link>
  )
}

export function PeoplePage({
  embedded = false,
  onMessage,
}: {
  embedded?: boolean
  onMessage?: (username: string) => void
}) {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const query = search.trim()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const people = useQuery({
    queryKey: ['people-search', query],
    queryFn: ({ signal }) => profilesApi.search(query, signal),
    enabled: query.length >= 2,
  })
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: ({ signal }) => profilesApi.friends(signal),
  })
  const requests = useQuery({
    queryKey: ['friend-requests'],
    queryFn: ({ signal }) => profilesApi.requests(signal),
  })
  const blocks = useQuery({
    queryKey: ['blocks'],
    queryFn: ({ signal }) => profilesApi.blocks(signal),
  })
  const action = useMutation({
    mutationFn: ({
      kind,
      username,
    }: {
      kind: 'request' | 'accept' | 'remove' | 'unblock'
      username: string
    }) => {
      if (kind === 'request') return profilesApi.sendRequest(username)
      if (kind === 'accept') return profilesApi.accept(username)
      if (kind === 'remove') return profilesApi.remove(username)
      return profilesApi.unblock(username)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['friends'] })
      await client.invalidateQueries({ queryKey: ['friend-requests'] })
      await client.invalidateQueries({ queryKey: ['blocks'] })
      await client.invalidateQueries({ queryKey: ['people-search'] })
    },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!embedded && (
        <header>
          <h1 className="text-3xl font-semibold">Люди</h1>
          <p className="mt-2 text-sm text-muted">
            Находите читателей и управляйте заявками в друзья.
          </p>
        </header>
      )}
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <h2 className="flex items-center gap-2 font-semibold">
          <Search size={18} /> Найти читателя
        </h2>
        <label
          htmlFor="people-search"
          className="mt-3 block text-sm text-muted"
        >
          Поиск по имени пользователя
        </label>
        <input
          id="people-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Введите минимум 2 символа"
          className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3 text-foreground"
        />
        {people.isError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {people.error.message}
          </p>
        )}
        {query.length >= 2 && (
          <div className="mt-3 space-y-2">
            {people.data?.map((person) => {
              const own = me.data?.username === person.username
              const friend = friends.data?.some(
                (item) => item.username === person.username,
              )
              const pending = requests.data?.find(
                (item) => item.username === person.username,
              )
              return (
                <div
                  key={person.username}
                  className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-3"
                >
                  <PersonLink person={person} />
                  {own ? (
                    <span className="text-xs text-muted">Вы</span>
                  ) : friend ? (
                    <span className="text-xs text-muted">Друг</span>
                  ) : pending ? (
                    <span className="text-xs text-muted">
                      {pending.incoming
                        ? 'Заявка от читателя'
                        : 'Заявка отправлена'}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          kind: 'request',
                          username: person.username,
                        })
                      }
                    >
                      <UserPlus size={15} /> Заявка
                    </Button>
                  )}
                </div>
              )
            })}
            {people.data?.length === 0 && (
              <p className="text-sm text-muted">Никого не нашли.</p>
            )}
          </div>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users size={18} /> Друзья
          </h2>
          <div className="mt-4 space-y-2">
            {friends.data?.map((person) => (
              <div
                key={person.username}
                className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-line p-3"
              >
                <PersonLink person={person} />
                {onMessage && (
                  <Button
                    variant="outline"
                    onClick={() => onMessage(person.username)}
                    aria-label={`Написать ${person.displayName || person.username}`}
                  >
                    <MessageCircle size={16} />
                    <span className="hidden sm:inline">Написать</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ kind: 'remove', username: person.username })
                  }
                >
                  Удалить
                </Button>
              </div>
            ))}
            {friends.data?.length === 0 && (
              <p className="text-sm text-muted">Пока нет друзей.</p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="font-semibold">Заявки</h2>
          <div className="mt-4 space-y-2">
            {requests.data?.map((person) => (
              <div
                key={person.username}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-3"
              >
                <PersonLink person={person} />
                {person.incoming ? (
                  <Button
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        kind: 'accept',
                        username: person.username,
                      })
                    }
                  >
                    Принять
                  </Button>
                ) : (
                  <span className="text-xs text-muted">Отправлена</span>
                )}
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ kind: 'remove', username: person.username })
                  }
                >
                  {person.incoming ? 'Отклонить' : 'Отменить'}
                </Button>
              </div>
            ))}
            {requests.data?.length === 0 && (
              <p className="text-sm text-muted">Новых заявок нет.</p>
            )}
          </div>
        </section>
      </div>
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <h2 className="font-semibold">Чёрный список</h2>
        <p className="mt-1 text-sm text-muted">
          Заблокированные пользователи не видят ваш профиль и не могут отправить
          заявку.
        </p>
        <div className="mt-3 space-y-2">
          {blocks.data?.map((person) => (
            <div
              key={person.username}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {person.displayName || person.username} @{person.username}
              </span>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ kind: 'unblock', username: person.username })
                }
              >
                Разблокировать
              </Button>
            </div>
          ))}
          {blocks.data?.length === 0 && (
            <p className="text-sm text-muted">Список пуст.</p>
          )}
        </div>
      </section>
      {action.isError && (
        <p role="alert" className="text-sm text-danger">
          {action.error.message}
        </p>
      )}
    </div>
  )
}
