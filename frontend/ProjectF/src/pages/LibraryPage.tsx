import { useDeferredValue, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarClock,
  Clock3,
  FileText,
  LibraryBig,
  Pencil,
  Search,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  booksApi,
  type BookItem,
  type LibrarySort,
  type LibraryStatus,
} from '../api/books'
import { DocumentUpload } from '../components/DocumentUpload'
import { Button } from '../components/ui/button'

const statuses: Record<LibraryStatus, string> = {
  want_to_read: 'Хочу прочитать',
  reading: 'Читаю',
  finished: 'Прочитано',
}

function readingTime(seconds: number) {
  if (seconds < 60) return seconds ? '< 1 мин' : 'Пока не читали'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [hours && `${hours} ч`, minutes && `${minutes} мин`]
    .filter(Boolean)
    .join(' ')
}

function readDate(value?: string) {
  if (!value) return 'Ещё не открывали'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function LibraryPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [status, setStatus] = useState<LibraryStatus | 'all'>('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [editing, setEditing] = useState<BookItem | null>(null)
  const [author, setAuthor] = useState('')
  const [genres, setGenres] = useState('')

  const filters = { q: deferredSearch, status, sort }
  const query = useQuery({
    queryKey: ['books', page, filters],
    queryFn: ({ signal }) => booksApi.list(page, filters, signal),
    refetchInterval: (result) =>
      result.state.data?.items.some((book) =>
        ['queued', 'processing'].includes(book.preparation),
      )
        ? 2500
        : false,
  })

  const updateLibrary = useMutation({
    mutationFn: ({
      book,
      nextStatus,
      nextAuthor = book.author,
      nextGenres = book.genres,
    }: {
      book: BookItem
      nextStatus: LibraryStatus
      nextAuthor?: string
      nextGenres?: string[]
    }) =>
      booksApi.saveLibrary(book.id, {
        status: nextStatus,
        author: nextAuthor?.trim() || undefined,
        genres: nextGenres,
      }),
    onSuccess: () => {
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const openEditor = (book: BookItem) => {
    setEditing(book)
    setAuthor(book.author ?? '')
    setGenres(book.genres.join(', '))
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        Личная библиотека
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        Ваши книги
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Загружайте книги, продолжайте с сохранённого места и возвращайтесь к
        важным фрагментам.
      </p>
      <DocumentUpload destination="reader" />

      <section
        aria-label="Фильтры библиотеки"
        className="mt-8 grid gap-3 rounded-2xl border border-line bg-surface p-4 md:grid-cols-[minmax(240px,1fr)_auto_auto]"
      >
        <label className="relative">
          <span className="sr-only">Поиск по книгам</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            size={18}
          />
          <input
            className="h-11 w-full rounded-xl border border-line bg-background pl-10 pr-4 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
            type="search"
            maxLength={100}
            placeholder="Название, автор или жанр"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
        </label>
        <select
          aria-label="Статус книги"
          className="h-11 rounded-xl border border-line bg-background px-3 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as LibraryStatus | 'all')
            setPage(0)
          }}
        >
          <option value="all">Все статусы</option>
          {Object.entries(statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Сортировка"
          className="h-11 rounded-xl border border-line bg-background px-3 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as LibrarySort)
            setPage(0)
          }}
        >
          <option value="recent">Недавно читали</option>
          <option value="added">Сначала новые</option>
          <option value="title">По названию</option>
          <option value="author">По автору</option>
          <option value="progress">По прогрессу</option>
          <option value="duration">По времени чтения</option>
        </select>
      </section>

      {query.isPending ? (
        <p className="mt-8" role="status">
          Загружаем библиотеку…
        </p>
      ) : query.isError ? (
        <div className="mt-8 rounded-2xl bg-danger-soft p-5" role="alert">
          <p>{query.error.message}</p>
          <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        </div>
      ) : query.data.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-10 text-center">
          <LibraryBig className="mx-auto text-muted" size={34} />
          <h2 className="mt-4 text-xl font-semibold">
            {search || status !== 'all' ? 'Книги не найдены' : 'Библиотека пока пустая'}
          </h2>
          <p className="mt-2 text-muted">
            {search || status !== 'all'
              ? 'Попробуйте изменить поиск или фильтр.'
              : 'Первая загруженная книга появится здесь.'}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {query.data.items.map((book) => {
            const progress = book.textLength
              ? Math.min(100, Math.round((book.positionOffset / book.textLength) * 100))
              : 0
            const ready = ['ready', 'not_started'].includes(book.preparation)
            return (
              <article
                key={book.id}
                className="document-card group flex min-h-80 overflow-hidden rounded-2xl border border-line bg-surface"
              >
                <div className="flex w-28 shrink-0 items-center justify-center overflow-hidden bg-accent-soft sm:w-32">
                  {book.hasCover ? (
                    <img
                      src={`/api/books/${encodeURIComponent(book.id)}/cover`}
                      alt={`Обложка книги «${book.title}»`}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="rounded-xl bg-surface/80 p-4 text-accent shadow-sm">
                      {book.format === 'manual' ? <FileText size={24} /> : <BookOpen size={24} />}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-5">
                  <div className="flex items-start gap-2">
                    <select
                      aria-label={`Статус книги «${book.title}»`}
                      className="min-w-0 flex-1 rounded-full border-0 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent outline-none ring-accent-line focus:ring-2"
                      value={book.libraryStatus}
                      disabled={updateLibrary.isPending}
                      onChange={(event) =>
                        updateLibrary.mutate({ book, nextStatus: event.target.value as LibraryStatus })
                      }
                    >
                      {Object.entries(statuses).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Изменить сведения о книге «${book.title}»`}
                      title="Изменить автора и жанры"
                      className="rounded-lg p-1.5 text-muted transition hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
                      onClick={() => openEditor(book)}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                  <h2 className="mt-4 line-clamp-3 text-lg font-semibold">{book.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">
                    {book.author || 'Автор не указан'}
                  </p>
                  {!!book.genres.length && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {book.genres.slice(0, 3).map((genre) => (
                        <span key={genre} className="rounded-full bg-subtle px-2 py-1 text-[11px] text-muted">
                          {genre}
                        </span>
                      ))}
                      {book.genres.length > 3 && (
                        <span className="px-1 py-1 text-[11px] text-muted">+{book.genres.length - 3}</span>
                      )}
                    </div>
                  )}
                  <dl className="mt-4 space-y-1.5 text-xs text-muted">
                    <div className="flex items-center gap-2">
                      <CalendarClock size={14} />
                      <dt className="sr-only">Последнее чтение</dt>
                      <dd>{readDate(book.lastReadAt)}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock3 size={14} />
                      <dt className="sr-only">Продолжительность чтения</dt>
                      <dd>{readingTime(book.readingSeconds)}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto pt-5">
                    <div className="flex justify-between gap-3 text-xs text-muted">
                      <span>{ready ? `${progress}% прочитано` : 'Подготовка книги…'}</span>
                      <span>{book.format.toUpperCase()}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-teal-600 transition-[width] duration-500"
                        style={{ width: `${ready ? progress : 8}%` }}
                      />
                    </div>
                    <Button asChild className="mt-4 w-full" variant={ready ? 'default' : 'outline'}>
                      <Link to={`/library/${book.id}/read`}>
                        {ready ? (progress ? 'Продолжить чтение' : 'Начать читать') : 'Открыть подготовку'}
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-7 flex items-center gap-4">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            Назад
          </Button>
          <span className="text-sm text-muted">{page + 1} / {query.data.totalPages}</span>
          <Button
            variant="outline"
            disabled={page + 1 >= query.data.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Далее
          </Button>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditing(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="book-metadata-title"
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">Сведения о книге</p>
                <h2 id="book-metadata-title" className="mt-2 line-clamp-2 text-xl font-semibold">
                  {editing.title}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground"
                onClick={() => setEditing(null)}
              >
                <X size={19} />
              </button>
            </div>
            <label className="mt-6 block text-sm font-medium">
              Автор
              <input
                className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3 outline-none focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
                maxLength={500}
                placeholder="Например, Фёдор Достоевский"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Жанры
              <input
                className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3 outline-none focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
                placeholder="Роман, классика, психология"
                value={genres}
                onChange={(event) => setGenres(event.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-muted">Разделяйте жанры запятыми. Можно указать до 12 жанров.</p>
            {updateLibrary.isError && (
              <p className="mt-4 text-sm text-danger" role="alert">{updateLibrary.error.message}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
              <Button
                disabled={updateLibrary.isPending}
                onClick={() =>
                  updateLibrary.mutate({
                    book: editing,
                    nextStatus: editing.libraryStatus,
                    nextAuthor: author,
                    nextGenres: genres
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean)
                      .filter(
                        (value, index, items) =>
                          items.findIndex(
                            (item) => item.toLocaleLowerCase('ru-RU') === value.toLocaleLowerCase('ru-RU'),
                          ) === index,
                      )
                      .slice(0, 12),
                  })
                }
              >
                {updateLibrary.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
