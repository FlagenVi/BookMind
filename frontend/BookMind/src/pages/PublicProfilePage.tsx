import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Clock3,
  MessageCircle,
  ShieldOff,
  UserPlus,
  Users,
} from 'lucide-react'
import { authApi } from '../api/auth'
import { profilesApi, type PublicBook } from '../api/profiles'
import { ActivityCalendar } from '../components/ActivityCalendar'
import { Button } from '../components/ui/button'

function BookCard({ username, book }: { username: string; book: PublicBook }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-page/60 p-3">
      {book.hasCover ? (
        <img
          loading="lazy"
          src={`/api/profiles/${encodeURIComponent(username)}/books/${encodeURIComponent(book.id)}/cover`}
          alt=""
          className="h-16 w-11 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="grid h-16 w-11 shrink-0 place-items-center rounded bg-accent-soft text-accent">
          <BookOpen size={18} />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-medium">{book.title}</p>
        <p className="truncate text-sm text-muted">
          {book.author || 'Автор не указан'}
        </p>
      </div>
    </div>
  )
}

export function PublicProfilePage() {
  const { username = '' } = useParams()
  const client = useQueryClient()
  const [page, setPage] = useState(0)
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const profile = useQuery({
    queryKey: ['public-profile', username],
    queryFn: ({ signal }) => profilesApi.get(username, signal),
    enabled: !!username,
  })
  const library = useQuery({
    queryKey: ['public-profile-books', username, page],
    queryFn: ({ signal }) => profilesApi.books(username, page, signal),
    enabled: !!profile.data?.libraryVisible,
  })
  const action = useMutation({
    mutationFn: (kind: 'request' | 'accept' | 'remove' | 'block') => {
      if (kind === 'request') return profilesApi.sendRequest(username)
      if (kind === 'accept') return profilesApi.accept(username)
      if (kind === 'remove') return profilesApi.remove(username)
      return profilesApi.block(username)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['public-profile', username] })
      await client.invalidateQueries({ queryKey: ['friends'] })
      await client.invalidateQueries({ queryKey: ['friend-requests'] })
    },
  })

  if (profile.isPending) return <p role="status">Загружаем профиль…</p>
  if (profile.isError || !profile.data)
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">Профиль недоступен</h1>
        <p className="mt-2 text-sm text-muted">
          Он закрыт, пользователь заблокирован или имя не найдено.
        </p>
        <Link
          to="/communication"
          className="mt-4 inline-block text-accent underline"
        >
          К поиску читателей
        </Link>
      </div>
    )

  const person = profile.data
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        to="/communication"
        className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
      >
        ← К читателям
      </Link>
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {person.hasAvatar ? (
            <img
              src={`/api/profiles/${encodeURIComponent(username)}/avatar`}
              alt="Аватар"
              className="size-20 shrink-0 rounded-2xl object-cover sm:size-28"
            />
          ) : (
            <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-accent-soft text-3xl text-accent sm:size-28">
              {(person.displayName || username).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">
              Профиль читателя
            </p>
            <h1 className="mt-2 break-words text-2xl font-semibold sm:text-3xl">
              {person.displayName || username}
            </h1>
            <p className="mt-1 text-sm text-muted">@{person.username}</p>
            {person.bio && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
                {person.bio}
              </p>
            )}
            {person.favoriteGenres.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {person.favoriteGenres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}
          </div>
          {me.data && person.relationship !== 'self' && (
            <div className="flex flex-wrap gap-2">
              {person.relationship === 'none' && (
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate('request')}
                >
                  <UserPlus size={16} /> В друзья
                </Button>
              )}
              {person.relationship === 'incoming' && (
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate('accept')}
                >
                  Принять заявку
                </Button>
              )}
              {person.relationship === 'outgoing' && (
                <span className="rounded-xl border border-line px-3 py-2 text-sm text-muted">
                  Заявка отправлена
                </span>
              )}
              {person.relationship === 'friends' && (
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate('remove')}
                >
                  Удалить из друзей
                </Button>
              )}
              {person.relationship === 'friends' && (
                <Button asChild>
                  <Link
                    to={`/communication?to=${encodeURIComponent(username)}`}
                  >
                    <MessageCircle size={16} />
                    Написать
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('block')}
              >
                <ShieldOff size={16} /> Заблокировать
              </Button>
            </div>
          )}
          {!me.data && (
            <Link to="/auth" className="text-sm text-accent underline">
              Войти, чтобы добавить в друзья
            </Link>
          )}
        </div>
        {action.isError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {action.error.message}
          </p>
        )}
      </section>

      {person.featuredBooks.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="font-semibold">Выбранные книги</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {person.featuredBooks.map((book) => (
              <BookCard key={book.id} username={username} book={book} />
            ))}
          </div>
        </section>
      )}

      {person.statisticsVisible && person.statistics && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="font-semibold">Статистика</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-page p-4">
              <Clock3 size={19} className="text-accent" />
              <p className="mt-2 text-xl font-semibold">
                {person.statistics.readingMinutes} мин
              </p>
              <p className="text-sm text-muted">Время чтения</p>
            </div>
            <div className="rounded-xl bg-page p-4">
              <BookOpen size={19} className="text-accent" />
              <p className="mt-2 text-xl font-semibold">
                {person.statistics.booksFinished}
              </p>
              <p className="text-sm text-muted">Завершено книг</p>
            </div>
          </div>
        </section>
      )}

      {person.activityVisible && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="font-semibold">Активность за год</h2>
          <ActivityCalendar
            activity={person.activity.map((day) => ({
              date: day.date,
              durationSeconds: Math.max(1, day.minutes * 60),
            }))}
            endDate={new Date().toISOString().slice(0, 10)}
          />
        </section>
      )}

      {person.libraryVisible && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="font-semibold">Библиотека</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {library.data?.map((book) => (
              <BookCard key={book.id} username={username} book={book} />
            ))}
          </div>
          {library.data?.length === 0 && (
            <p className="mt-3 text-sm text-muted">Пока нет книг.</p>
          )}
          {library.data?.length === 20 && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setPage((value) => value + 1)}
            >
              Следующие книги
            </Button>
          )}
          {page > 0 && (
            <Button
              variant="outline"
              className="mt-4 ml-2"
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </Button>
          )}
        </section>
      )}

      {person.friendsVisible && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users size={18} /> Друзья
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {person.friends.map((friend) => (
              <Link
                key={friend.username}
                to={`/people/${friend.username}`}
                className="inline-flex min-h-11 items-center rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent-line"
              >
                {friend.displayName || friend.username}
              </Link>
            ))}
          </div>
          {person.friends.length === 0 && (
            <p className="mt-2 text-sm text-muted">Список пуст.</p>
          )}
        </section>
      )}
    </div>
  )
}
