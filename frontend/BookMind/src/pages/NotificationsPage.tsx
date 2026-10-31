import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Bell,
  CheckCheck,
  MessageCircle,
  Settings2,
  UserPlus,
} from 'lucide-react'
import { socialApi, type NotificationPreferences } from '../api/social'
import { Button } from '../components/ui/button'
import { useSocialUnread } from '../social/useSocialUnread'

export function NotificationsPage() {
  const client = useQueryClient()
  const [onlyUnread, setOnlyUnread] = useState(false)
  const unread = useSocialUnread(true)
  const query = useInfiniteQuery({
    queryKey: ['social', 'notifications', onlyUnread],
    queryFn: ({ pageParam, signal }) =>
      socialApi.notifications(pageParam, signal, onlyUnread),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length : undefined,
    refetchInterval: 30000,
  })
  const preferences = useQuery({
    queryKey: ['social', 'notification-preferences'],
    queryFn: ({ signal }) => socialApi.preferences(signal),
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['social'] })
  const read = useMutation({ mutationFn: socialApi.seen, onSuccess: refresh })
  const readAll = useMutation({
    mutationFn: socialApi.seenAll,
    onSuccess: refresh,
  })
  const save = useMutation({
    mutationFn: (input: NotificationPreferences) =>
      socialApi.savePreferences(input),
    onSuccess: refresh,
  })
  const visible = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ]
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Уведомления</h1>
          <p className="mt-2 text-sm text-muted">
            Заявки в друзья и новые сообщения.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={readAll.isPending || !unread.data?.notifications}
          onClick={() => readAll.mutate()}
        >
          <CheckCheck size={17} />
          Прочитать все
        </Button>
      </header>
      <details className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
          <Settings2 size={18} />
          Настройки уведомлений
        </summary>
        {preferences.isPending && (
          <p role="status" className="mt-3 text-sm text-muted">
            Загружаем настройки…
          </p>
        )}
        {preferences.data && (
          <div className="mt-3 space-y-2">
            {(
              [
                ['messages', 'Сообщения'],
                ['friends', 'Заявки и принятие в друзья'],
                ['paused', 'Приостановить новые уведомления'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-11 items-center gap-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={preferences.data[key]}
                  disabled={save.isPending}
                  onChange={(event) =>
                    save.mutate({
                      ...preferences.data!,
                      [key]: event.target.checked,
                    })
                  }
                  className="size-5 accent-primary"
                />
                {label}
              </label>
            ))}
            <p className="text-xs text-muted">
              Эти настройки влияют на новые уведомления. Сообщения и заявки
              продолжают приходить.
            </p>
          </div>
        )}
        {(preferences.isError || save.isError) && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {preferences.error?.message ?? save.error?.message}
          </p>
        )}
      </details>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={onlyUnread}
          onChange={(event) => setOnlyUnread(event.target.checked)}
          className="size-5 accent-primary"
        />
        Только непрочитанные
      </label>
      {query.isPending && <p role="status">Загружаем уведомления…</p>}
      {(query.isError || read.isError || readAll.isError) && (
        <p role="alert" className="text-sm text-danger">
          {query.error?.message ??
            read.error?.message ??
            readAll.error?.message}
        </p>
      )}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {visible.map((item) => (
          <li
            key={item.id}
            className={`flex items-start gap-3 p-4 sm:p-5 ${item.seen ? '' : 'bg-accent-soft/40'}`}
          >
            <span className="mt-1 shrink-0 text-accent">
              {item.kind === 'message' ? (
                <MessageCircle size={20} />
              ) : (
                <UserPlus size={20} />
              )}
            </span>
            <Link
              to={
                item.conversationId
                  ? `/communication?chat=${item.conversationId}`
                  : '/communication?tab=people'
              }
              onClick={() => {
                if (!item.seen) read.mutate(item.id)
              }}
              className="min-w-0 flex-1 rounded-lg"
            >
              <p className="break-words text-sm">
                <span className="font-semibold">
                  {item.actor.displayName || item.actor.username || 'Читатель'}
                </span>
                {item.kind === 'message'
                  ? ' прислал сообщение'
                  : item.kind === 'friend_request'
                    ? ' хочет добавить вас в друзья'
                    : ' принял вашу заявку в друзья'}
              </p>
              <time
                dateTime={item.occurredAt}
                className="mt-2 block text-xs text-muted"
              >
                {new Date(item.occurredAt).toLocaleString('ru-RU', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </Link>
            {!item.seen && (
              <Button
                variant="outline"
                className="shrink-0 px-3"
                aria-label="Отметить уведомление прочитанным"
                onClick={() => read.mutate(item.id)}
                disabled={read.isPending}
              >
                <CheckCheck size={17} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!query.isPending && !visible.length && (
        <div className="py-10 text-center">
          <Bell size={28} className="mx-auto text-muted" />
          <p className="mt-4 font-medium">
            {onlyUnread ? 'Всё прочитано' : 'Пока нет уведомлений'}
          </p>
          <p className="mt-2 text-sm text-muted">
            Новые сообщения и заявки появятся здесь.
          </p>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </Button>
      )}
    </div>
  )
}
