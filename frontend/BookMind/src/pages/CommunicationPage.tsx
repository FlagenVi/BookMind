import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCheck,
  MessageCircle,
  Pencil,
  Reply,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { authApi } from '../api/auth'
import {
  messagePreview,
  socialApi,
  type ChatMessage,
  type Conversation,
} from '../api/social'
import { Button } from '../components/ui/button'
import { ModalDialog } from '../components/ui/modal-dialog'
import { ShareBookDialog } from '../components/ShareBookDialog'
import { enqueueMessage, updateOutgoing, useOutbox } from '../social/outbox'
import { useSocialConnection } from '../social/connection'
import { PeoplePage } from './PeoplePage'

const personName = (conversation: Conversation) =>
  conversation.person.displayName || conversation.person.username || 'Читатель'
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent"
      aria-hidden="true"
    >
      {name.slice(0, 1).toLocaleUpperCase('ru')}
    </span>
  )
}
export function CommunicationPage() {
  const [params, setParams] = useSearchParams()
  const people = params.get('tab') === 'people'
  const id = params.get('chat') ?? ''
  const to = params.get('to') ?? ''
  const client = useQueryClient()
  const [openError, setOpenError] = useState('')
  const [filter, setFilter] = useState('')
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const conversations = useQuery({
    queryKey: ['social', 'conversations'],
    queryFn: ({ signal }) => socialApi.conversations(signal),
    refetchInterval: 30000,
  })
  const open = useMutation({
    mutationFn: (username: string) => socialApi.open(username),
    onSuccess: (chat) => {
      void client.invalidateQueries({ queryKey: ['social'] })
      setParams({ chat: chat.id })
    },
  })
  useEffect(() => {
    if (!to) return
    const controller = new AbortController()
    socialApi
      .open(to, controller.signal)
      .then((chat) => {
        if (!controller.signal.aborted) {
          void client.invalidateQueries({ queryKey: ['social'] })
          setParams({ chat: chat.id }, { replace: true })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setOpenError(
            error instanceof Error
              ? error.message
              : 'Не удалось открыть беседу',
          )
      })
    return () => controller.abort()
  }, [to, client, setParams])
  const items =
    conversations.data?.filter(
      (chat) =>
        personName(chat)
          .toLocaleLowerCase('ru')
          .includes(filter.toLocaleLowerCase('ru')) ||
        chat.person.username?.includes(filter),
    ) ?? []
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Общение</h1>
        <nav
          className="flex gap-1 rounded-xl border border-line p-1"
          aria-label="Разделы общения"
        >
          <Link
            to="/communication"
            aria-current={!people ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium ${!people ? 'bg-accent-soft text-accent' : 'text-muted'}`}
          >
            <MessageCircle size={17} />
            Сообщения
          </Link>
          <Link
            to="/communication?tab=people"
            aria-current={people ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium ${people ? 'bg-accent-soft text-accent' : 'text-muted'}`}
          >
            <Users size={17} />
            Люди
          </Link>
        </nav>
      </header>
      {(open.isError || openError) && (
        <p role="alert" className="text-sm text-danger">
          {open.error?.message || openError}
        </p>
      )}
      {people ? (
        <PeoplePage embedded onMessage={(username) => open.mutate(username)} />
      ) : (
        <div className="grid overflow-hidden rounded-2xl border border-line bg-surface md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.8fr)]">
          <aside
            className={`${id ? 'hidden md:flex' : 'flex'} min-h-[28rem] flex-col border-line md:border-r`}
            aria-label="Беседы"
          >
            <label className="m-4 flex h-11 items-center gap-2 rounded-xl border border-line px-3">
              <Search size={17} className="shrink-0 text-muted" />
              <input
                aria-label="Поиск бесед"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Найти беседу"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            {conversations.isPending && (
              <p role="status" className="px-4 py-3 text-sm text-muted">
                Загружаем беседы…
              </p>
            )}
            {conversations.isError && (
              <div role="alert" className="p-4 text-sm text-danger">
                {conversations.error.message}
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => void conversations.refetch()}
                >
                  Повторить
                </Button>
              </div>
            )}
            <ul className="max-h-[65dvh] overflow-y-auto">
              {items.map((chat) => (
                <li key={chat.id}>
                  <Link
                    to={`/communication?chat=${chat.id}`}
                    aria-current={id === chat.id ? 'page' : undefined}
                    className={`flex min-h-20 items-center gap-3 border-b border-line px-4 py-3 transition hover:bg-subtle ${id === chat.id ? 'bg-accent-soft/60' : ''}`}
                  >
                    <Avatar name={personName(chat)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {personName(chat)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {messagePreview(chat.lastMessage)}
                      </span>
                    </span>
                    {chat.unread > 0 && (
                      <span
                        className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white"
                        aria-label={`${chat.unread} непрочитанных`}
                      >
                        {chat.unread > 99 ? '99+' : chat.unread}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {!conversations.isPending && !items.length && (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-muted">
                  {filter
                    ? 'Беседы не найдены'
                    : 'Здесь будут ваши разговоры с друзьями.'}
                </p>
                <Link
                  to="/communication?tab=people"
                  className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline"
                >
                  Найти собеседника
                </Link>
              </div>
            )}
          </aside>
          {id && me.data ? (
            <ConversationThread
              key={id}
              id={id}
              userId={me.data.id}
              onBack={() => setParams({})}
            />
          ) : (
            <section className="hidden min-h-[28rem] flex-col items-center justify-center gap-3 p-8 text-center md:flex">
              <MessageCircle size={32} className="text-muted" />
              <h2 className="text-lg font-semibold">Выберите беседу</h2>
              <p className="max-w-xs text-sm leading-6 text-muted">
                Обсуждайте прочитанное, рекомендуйте книги и делитесь цитатами.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function ConversationThread({
  id,
  userId,
  onBack,
}: {
  id: string
  userId: string
  onBack: () => void
}) {
  const client = useQueryClient()
  const connection = useSocialConnection()
  const [body, setBody] = useState('')
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const [share, setShare] = useState(false)
  const [error, setError] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search.trim())
  const viewport = useRef<HTMLDivElement>(null)
  const previousScroll = useRef<{ height: number; top: number } | null>(null)
  const lastRead = useRef(0)
  const chat = useQuery({
    queryKey: ['social', 'conversation', id],
    queryFn: ({ signal }) => socialApi.conversation(id, signal),
    refetchInterval: 30000,
  })
  const history = useInfiniteQuery({
    queryKey: ['social', 'messages', id, query],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      socialApi.messages(id, pageParam, signal, query),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
    refetchInterval: 30000,
  })
  const messages = useMemo(() => {
    const unique = new Map<number, ChatMessage>()
    history.data?.pages.forEach((page) =>
      page.items.forEach((message) => unique.set(message.id, message)),
    )
    return [...unique.values()].sort((a, b) => a.id - b.id)
  }, [history.data])
  const outgoing = useOutbox(userId).filter(
    (item) => item.conversationId === id,
  )
  const latestId = messages.at(-1)?.id ?? 0
  const refresh = () => client.invalidateQueries({ queryKey: ['social'] })
  const save = useMutation({
    mutationFn: () => socialApi.edit(id, editing!.id, body),
    onSuccess: () => {
      setEditing(null)
      setBody('')
      void refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => socialApi.remove(id, deleting!.id),
    onSuccess: () => {
      setDeleting(null)
      void refresh()
    },
  })
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    if (previousScroll.current) {
      element.scrollTop =
        previousScroll.current.top +
        element.scrollHeight -
        previousScroll.current.height
      previousScroll.current = null
    } else if (atBottom) element.scrollTop = element.scrollHeight
  }, [messages, outgoing.length, atBottom])
  useEffect(() => {
    const mark = () => {
      if (
        query ||
        !latestId ||
        !atBottom ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        latestId <= lastRead.current
      )
        return
      lastRead.current = latestId
      void socialApi
        .read(id, latestId)
        .then(() => client.invalidateQueries({ queryKey: ['social'] }))
        .catch(() => {
          lastRead.current = 0
        })
    }
    mark()
    window.addEventListener('focus', mark)
    document.addEventListener('visibilitychange', mark)
    return () => {
      window.removeEventListener('focus', mark)
      document.removeEventListener('visibilitychange', mark)
    }
  }, [id, latestId, atBottom, client, query])
  const submit = () => {
    setError('')
    if (editing) {
      save.mutate()
      return
    }
    try {
      enqueueMessage(userId, id, { body, replyTo: reply?.id })
      setBody('')
      setReply(null)
      setAtBottom(true)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Не удалось добавить сообщение в очередь',
      )
    }
  }
  return (
    <section
      className="flex h-[calc(100dvh-17rem)] min-h-[30rem] min-w-0 flex-col"
      aria-label="Личная беседа"
    >
      <header className="flex min-h-20 items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
        <Button
          variant="outline"
          className="px-3 md:hidden"
          onClick={onBack}
          aria-label="К списку бесед"
        >
          <ArrowLeft size={18} />
        </Button>
        {chat.data && (
          <>
            <Avatar name={personName(chat.data)} />
            <div className="min-w-0 flex-1">
              {chat.data.person.username ? (
                <Link
                  to={`/people/${encodeURIComponent(chat.data.person.username)}`}
                  className="block truncate font-semibold hover:text-accent"
                >
                  {personName(chat.data)}
                </Link>
              ) : (
                <p className="font-semibold">{personName(chat.data)}</p>
              )}
              <p className="mt-1 text-xs text-muted">
                {connection === 'connected'
                  ? 'Личная беседа'
                  : connection === 'offline'
                    ? 'Нет сети · сообщения останутся в очереди'
                    : 'Восстанавливаем соединение…'}
              </p>
            </div>
          </>
        )}
        {chat.isPending && <p role="status">Открываем беседу…</p>}
      </header>
      {(chat.isError || history.isError) && (
        <div className="p-4 text-sm text-danger" role="alert">
          {chat.error?.message ?? history.error?.message}
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => {
              void chat.refetch()
              void history.refetch()
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      <label className="mx-3 my-2 flex h-10 shrink-0 items-center gap-2 rounded-xl border border-line px-3 sm:mx-5">
        <Search size={16} className="shrink-0 text-muted" />
        <input
          aria-label="Поиск по сообщениям"
          placeholder="Поиск в беседе"
          maxLength={100}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {search && (
          <button
            type="button"
            className="grid size-9 place-items-center text-muted"
            aria-label="Очистить поиск в беседе"
            onClick={() => setSearch('')}
          >
            <X size={15} />
          </button>
        )}
      </label>
      <div
        ref={viewport}
        onScroll={() => {
          const el = viewport.current
          if (el)
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        role="log"
        aria-label="История сообщений"
        aria-live="polite"
        aria-relevant="additions"
      >
        {history.hasNextPage && (
          <div className="mb-5 text-center">
            <Button
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => {
                if (viewport.current)
                  previousScroll.current = {
                    height: viewport.current.scrollHeight,
                    top: viewport.current.scrollTop,
                  }
                void history.fetchNextPage()
              }}
            >
              {history.isFetchingNextPage
                ? 'Загружаем…'
                : 'Более ранние сообщения'}
            </Button>
          </div>
        )}
        {history.isPending && (
          <p role="status" className="text-center text-sm text-muted">
            Загружаем сообщения…
          </p>
        )}
        {!history.isPending && !messages.length && !outgoing.length && (
          <p className="py-8 text-center text-sm text-muted">
            {query
              ? 'Сообщения не найдены.'
              : 'Начните разговор — отправьте сообщение или порекомендуйте книгу.'}
          </p>
        )}
        <ol className="space-y-4">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              peerReadId={chat.data?.peerReadId ?? 0}
              canSend={chat.data?.canSend ?? false}
              showDate={
                index === 0 ||
                new Date(messages[index - 1].createdAt).toDateString() !==
                  new Date(message.createdAt).toDateString()
              }
              onReply={() => {
                setEditing(null)
                if (editing) setBody('')
                setReply(message)
              }}
              onEdit={() => {
                setReply(null)
                setEditing(message)
                setBody(message.body)
                save.reset()
              }}
              onDelete={() => {
                remove.reset()
                setDeleting(message)
              }}
            />
          ))}
          {outgoing.map((item) => (
            <li
              key={item.input.clientId}
              className="ml-auto max-w-[90%] rounded-2xl bg-accent-soft px-4 py-3 text-sm"
            >
              <p className="whitespace-pre-wrap break-words">
                {item.input.body || item.preview || 'Книга'}
              </p>
              <p
                className={`mt-2 text-xs ${item.failed ? 'text-danger' : 'text-muted'}`}
                role="status"
              >
                {item.error ||
                  (connection === 'offline'
                    ? 'Нет сети · в очереди отправки'
                    : 'Отправляется…')}
              </p>
              {item.failed && (
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    className="min-h-11 font-medium text-accent"
                    onClick={() =>
                      updateOutgoing(userId, item.input.clientId, {
                        failed: false,
                        error: undefined,
                      })
                    }
                  >
                    Повторить
                  </button>
                  <button
                    type="button"
                    className="min-h-11 text-muted"
                    onClick={() =>
                      updateOutgoing(userId, item.input.clientId, null)
                    }
                  >
                    Убрать из очереди
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
      {!atBottom && (
        <button
          type="button"
          className="min-h-11 border-t border-line text-sm font-medium text-accent"
          onClick={() => setAtBottom(true)}
        >
          К последним сообщениям
        </button>
      )}
      {chat.data?.canSend ? (
        <form
          className="border-t border-line p-3 sm:p-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          {(reply || editing) && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-subtle px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {editing ? 'Редактирование сообщения' : 'Ответ на сообщение'}
                </p>
                <p className="mt-1 truncate text-xs text-muted">
                  {messagePreview(editing || reply)}
                </p>
              </div>
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-lg text-muted"
                aria-label="Отменить ответ или редактирование"
                onClick={() => {
                  setReply(null)
                  setEditing(null)
                  if (editing) setBody('')
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="direct-message-body">
            Сообщение
          </label>
          <textarea
            id="direct-message-body"
            rows={2}
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Написать сообщение…"
            className="w-full resize-none rounded-xl border border-line bg-page px-3 py-2.5 text-sm"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                if (body.trim() || editing?.bookTitle) submit()
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!!editing}
              onClick={() => setShare(true)}
            >
              <BookOpen size={17} />
              Книга
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">{body.length}/4000</span>
              <Button
                type="submit"
                disabled={
                  save.isPending || (!body.trim() && !editing?.bookTitle)
                }
                aria-label={
                  editing ? 'Сохранить сообщение' : 'Отправить сообщение'
                }
              >
                <Send size={17} />
                <span className="hidden sm:inline">
                  {editing ? 'Сохранить' : 'Отправить'}
                </span>
              </Button>
            </div>
          </div>
          {(error || save.isError) && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error || save.error?.message}
            </p>
          )}
        </form>
      ) : (
        chat.data && (
          <p className="border-t border-line p-4 text-sm text-muted">
            Отправлять сообщения можно только друзьям без блокировки. История
            переписки сохранена.
          </p>
        )
      )}
      {share && (
        <ShareBookDialog conversationId={id} onClose={() => setShare(false)} />
      )}
      {deleting && (
        <ModalDialog
          role="alertdialog"
          labelledBy="delete-message-title"
          onClose={() => setDeleting(null)}
          closeDisabled={remove.isPending}
          className="w-full max-w-md rounded-2xl bg-surface p-6"
        >
          <h2 id="delete-message-title" className="text-lg font-semibold">
            Удалить сообщение у обоих участников?
          </h2>
          <p className="mt-3 text-sm text-muted">
            В переписке останется отметка об удалении.
          </p>
          {remove.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {remove.error.message}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Отмена
            </Button>
            <Button disabled={remove.isPending} onClick={() => remove.mutate()}>
              Удалить
            </Button>
          </div>
        </ModalDialog>
      )}
    </section>
  )
}

function MessageBubble({
  message,
  peerReadId,
  canSend,
  showDate,
  onReply,
  onEdit,
  onDelete,
}: {
  message: ChatMessage
  peerReadId: number
  canSend: boolean
  showDate: boolean
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <li>
      {showDate && (
        <p className="mb-4 text-center text-xs text-muted">
          {new Date(message.createdAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      )}
      <article
        className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[85%] ${message.mine ? 'ml-auto bg-accent-soft' : 'mr-auto bg-subtle'}`}
      >
        {message.reply && (
          <div className="mb-3 rounded-lg bg-page/60 px-3 py-2 text-xs">
            <p className="font-semibold text-accent">{message.reply.author}</p>
            <p className="mt-1 line-clamp-2 break-words text-muted">
              {message.reply.text}
            </p>
          </div>
        )}
        {message.deleted ? (
          <p className="text-sm italic text-muted">Сообщение удалено</p>
        ) : (
          <>
            {message.bookTitle && (
              <div className="mb-3 border-b border-line pb-3">
                <div className="flex items-start gap-2">
                  <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted">
                      {message.quote ? 'Цитата' : 'Рекомендация'}
                    </p>
                    <p className="mt-1 break-words text-sm font-semibold">
                      {message.bookTitle}
                    </p>
                    {message.bookAuthor && (
                      <p className="mt-1 text-xs text-muted">
                        {message.bookAuthor}
                      </p>
                    )}
                  </div>
                </div>
                {message.quote &&
                  (message.spoiler && !revealed ? (
                    <button
                      type="button"
                      className="mt-3 min-h-11 w-full rounded-xl border border-line px-3 text-sm font-medium text-accent"
                      onClick={() => setRevealed(true)}
                    >
                      Возможен спойлер · Показать цитату
                    </button>
                  ) : (
                    <blockquote className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                      «{message.quote}»
                    </blockquote>
                  ))}
              </div>
            )}
            {message.body && (
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {message.body}
              </p>
            )}
          </>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1 text-xs text-muted">
          <time dateTime={message.createdAt}>
            {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
          {message.editedAt && !message.deleted && <span>· изменено</span>}
          {message.mine &&
            (message.id <= peerReadId ? (
              <span aria-label="Прочитано">
                <CheckCheck size={15} className="text-accent" />
              </span>
            ) : (
              <span aria-label="Доставлено">
                <Check size={15} />
              </span>
            ))}
        </div>
        {!message.deleted && (
          <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-line/60 pt-1">
            {canSend && (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted hover:text-accent"
                onClick={onReply}
              >
                <Reply size={14} />
                Ответить
              </button>
            )}
            {message.mine && (
              <>
                {canSend && (
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted hover:text-accent"
                    onClick={onEdit}
                  >
                    <Pencil size={13} />
                    Изменить
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted hover:text-danger"
                  onClick={onDelete}
                >
                  <Trash2 size={13} />
                  Удалить
                </button>
              </>
            )}
          </div>
        )}
      </article>
    </li>
  )
}
