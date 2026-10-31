import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BookOpen, Send, X } from 'lucide-react'
import { authApi } from '../api/auth'
import { booksApi } from '../api/books'
import { profilesApi } from '../api/profiles'
import { socialApi } from '../api/social'
import { enqueueMessage } from '../social/outbox'
import { Button } from './ui/button'
import { ModalDialog } from './ui/modal-dialog'

export type SharedQuote = {
  startOffset: number
  endOffset: number
  exactText: string
}
export function ShareBookDialog({
  bookId: initialBookId,
  quote,
  conversationId,
  onClose,
}: {
  bookId?: string
  quote?: SharedQuote
  conversationId?: string
  onClose: () => void
}) {
  const [bookId, setBookId] = useState(initialBookId ?? '')
  const [search, setSearch] = useState('')
  const [username, setUsername] = useState('')
  const [body, setBody] = useState('')
  const [spoiler, setSpoiler] = useState(true)
  const [sent, setSent] = useState(false)
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: ({ signal }) => profilesApi.friends(signal),
    enabled: !conversationId,
  })
  const books = useQuery({
    queryKey: ['social', 'share-books', search],
    queryFn: ({ signal }) => booksApi.list(0, { q: search }, signal),
    enabled: !initialBookId,
  })
  const book = useQuery({
    queryKey: ['book-details', bookId],
    queryFn: ({ signal }) => booksApi.details(bookId, signal),
    enabled: !!bookId,
  })
  const send = useMutation({
    mutationFn: async () => {
      if (!me.data) throw new Error('Необходимо войти в аккаунт')
      if (!bookId) throw new Error('Выберите книгу')
      const id = conversationId ?? (await socialApi.open(username)).id
      enqueueMessage(
        me.data.id,
        id,
        {
          body,
          bookId,
          startOffset: quote?.startOffset,
          endOffset: quote?.endOffset,
          spoiler,
        },
        book.data?.title,
      )
      return id
    },
    onSuccess: () => setSent(true),
  })
  return (
    <ModalDialog
      labelledBy="share-book-title"
      onClose={onClose}
      closeDisabled={send.isPending}
      className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="share-book-title" className="text-xl font-semibold">
          {quote ? 'Поделиться цитатой' : 'Рекомендовать книгу'}
        </h2>
        <Button
          variant="outline"
          className="px-3"
          aria-label="Закрыть отправку"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      {sent ? (
        <div className="mt-5 space-y-4">
          <p role="status">
            Сообщение добавлено в очередь отправки. Если связи нет, оно
            отправится после подключения.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Готово
            </Button>
            <Button asChild>
              <Link onClick={onClose} to={`/communication?chat=${send.data}`}>
                Открыть беседу
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-5 space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            send.mutate()
          }}
        >
          {!initialBookId && (
            <div>
              <label
                htmlFor="share-book-search"
                className="text-sm font-medium"
              >
                Книга из библиотеки
              </label>
              <input
                id="share-book-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Найти по названию"
                className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3"
              />
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-line">
                {books.isPending && (
                  <p role="status" className="p-3 text-sm text-muted">
                    Загружаем книги…
                  </p>
                )}
                {books.isError && (
                  <p role="alert" className="p-3 text-sm text-danger">
                    {books.error.message}
                  </p>
                )}
                {books.data?.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex min-h-11 items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0"
                  >
                    <input
                      type="radio"
                      name="shared-book"
                      value={item.id}
                      checked={bookId === item.id}
                      onChange={() => setBookId(item.id)}
                      className="accent-primary"
                    />
                    <span className="min-w-0 truncate">{item.title}</span>
                  </label>
                ))}
                {books.data?.items.length === 0 && (
                  <p className="p-3 text-sm text-muted">Книги не найдены.</p>
                )}
              </div>
            </div>
          )}
          {bookId && (
            <div className="flex items-center gap-3 border-b border-line pb-4">
              <BookOpen size={22} className="shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {book.data?.title ?? 'Загружаем книгу…'}
                </p>
                <p className="text-sm text-muted">{book.data?.author}</p>
              </div>
            </div>
          )}
          {book.isError && (
            <p role="alert" className="text-sm text-danger">
              {book.error.message}
            </p>
          )}
          {quote && (
            <>
              <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-secondary">
                «{quote.exactText}»
              </blockquote>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={spoiler}
                  onChange={(event) => setSpoiler(event.target.checked)}
                  className="size-5 accent-primary"
                />
                Скрыть цитату предупреждением о спойлере
              </label>
            </>
          )}
          {!conversationId && (
            <div>
              <label htmlFor="share-recipient" className="text-sm font-medium">
                Кому отправить
              </label>
              <select
                id="share-recipient"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3"
              >
                <option value="">Выберите друга</option>
                {friends.data?.map((person) => (
                  <option key={person.username} value={person.username}>
                    {person.displayName || person.username}
                  </option>
                ))}
              </select>
              {friends.isError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {friends.error.message}
                </p>
              )}
              {friends.data?.length === 0 && (
                <p className="mt-2 text-sm text-muted">
                  Добавьте читателя в друзья в разделе «Общение».
                </p>
              )}
            </div>
          )}
          <label className="block text-sm font-medium">
            Комментарий
            <input
              value={body}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Почему стоит прочитать?"
              className="mt-2 h-11 w-full rounded-xl border border-line bg-page px-3"
            />
          </label>
          <p className="text-xs leading-5 text-muted">
            Друг получит название, автора{quote ? ' и выбранную цитату' : ''}.
            Исходный файл и доступ к вашей библиотеке не передаются.
          </p>
          {send.isError && (
            <p role="alert" className="text-sm text-danger">
              {send.error.message}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              disabled={
                send.isPending || !book.data || (!conversationId && !username)
              }
            >
              <Send size={17} />
              {send.isPending ? 'Отправляем…' : 'Отправить'}
            </Button>
          </div>
        </form>
      )}
    </ModalDialog>
  )
}
