import { useCallback, useDeferredValue, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarClock,
  Clock3,
  Download,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Grid2X2,
  Heart,
  Info,
  LibraryBig,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  booksApi,
  type BookCollection,
  type BookDetails,
  type BookDetailsInput,
  type BookItem,
  type BookPage,
  type LibrarySort,
  type LibraryStatus,
  type SortDirection,
} from '../api/books'
import { ApiError } from '../api/client'
import { DocumentUpload } from '../components/DocumentUpload'
import { Button } from '../components/ui/button'
import { ModalDialog } from '../components/ui/modal-dialog'
import { NativeSelect } from '../components/ui/native-select'
import { SideDrawer } from '../components/ui/side-drawer'
import { languageDisplayName } from '../library/bookDetailsFormat'
import {
  bookPageQueries,
  setCachedBookFavorite,
} from '../library/bookFavoriteCache'

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

function detailsDate(value: string | null) {
  if (!value) return 'Не указано'
  if (/^\d{4}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function fileSize(value: number | null) {
  if (value === null) return 'Не указано'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: unit ? 1 : 0,
  }).format(size)} ${units[unit]}`
}

function normalizeGenres(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase('ru-RU') ===
            item.toLocaleLowerCase('ru-RU'),
        ) === index,
    )
    .slice(0, 12)
}

type DetailsForm = Omit<BookDetailsInput, 'genres'> & { genres: string }
type LibraryView = 'grid' | 'compact'

function initialLibraryView(): LibraryView {
  try {
    return localStorage.getItem('library-view') === 'compact'
      ? 'compact'
      : 'grid'
  } catch {
    return 'grid'
  }
}

function formFromDetails(details: BookDetails): DetailsForm {
  return {
    title: details.title,
    author: details.author,
    publisher: details.publisher,
    publicationDate: details.publicationDate,
    language: details.language,
    genres: details.genres.join(', '),
    description: details.description,
  }
}

function refreshErrorMessage(error: Error) {
  if (!(error instanceof ApiError)) return error.message
  if (error.status === 409) return 'Исходный файл книги недоступен'
  if (error.status === 422)
    return error.message === 'Не удалось выполнить запрос'
      ? 'В файле не найдены дополнительные метаданные'
      : error.message
  return error.message
}

export function LibraryPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [status, setStatus] = useState<LibraryStatus | 'all'>('all')
  const [format, setFormat] = useState('all')
  const [genre, setGenre] = useState('')
  const [favorite, setFavorite] = useState<'all' | 'yes'>('all')
  const [collection, setCollection] = useState('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [direction, setDirection] = useState<SortDirection>('default')
  const [view, setView] = useState<LibraryView>(initialLibraryView)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchStatus, setBatchStatus] = useState<LibraryStatus>('reading')
  const [detailsBook, setDetailsBook] = useState<BookItem | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState<DetailsForm | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  const [collectionEditor, setCollectionEditor] = useState<
    BookCollection | 'new' | null
  >(null)
  const [collectionName, setCollectionName] = useState('')
  const [confirmCollectionDelete, setConfirmCollectionDelete] = useState(false)
  const [moveTarget, setMoveTarget] = useState<{
    ids: string[]
    label: string
  } | null>(null)
  const [moveCollectionId, setMoveCollectionId] = useState('')
  const [deleting, setDeleting] = useState<{
    id: string
    title: string
  } | null>(null)

  const filters = {
    q: deferredSearch,
    status,
    format,
    genre,
    favorite,
    collection,
    sort,
    direction,
  }
  const activeFilterCount = [
    status !== 'all',
    format !== 'all',
    genre !== '',
    favorite !== 'all',
    sort !== 'recent',
    direction !== 'default',
  ].filter(Boolean).length
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
  const facets = useQuery({
    queryKey: ['books', 'facets'],
    queryFn: ({ signal }) => booksApi.facets(signal),
  })
  const collections = useQuery({
    queryKey: ['book-collections'],
    queryFn: ({ signal }) => booksApi.collections(signal),
  })
  const collectionItems = Array.isArray(collections.data)
    ? collections.data
    : []

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
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const updateFavorite = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      booksApi.saveFavorite(id, value),
    onMutate: async ({ id, value }) => {
      await Promise.all([
        queryClient.cancelQueries(bookPageQueries),
        queryClient.cancelQueries({ queryKey: ['book', id, 'details'] }),
      ])

      const previousBooks =
        queryClient.getQueriesData<BookPage>(bookPageQueries)
      const previousDetails = queryClient.getQueryData<BookDetails>([
        'book',
        id,
        'details',
      ])

      setCachedBookFavorite(queryClient, id, value)
      queryClient.setQueryData<BookDetails>(
        ['book', id, 'details'],
        (current) => (current ? { ...current, favorite: value } : current),
      )

      return { id, previousBooks, previousDetails }
    },
    onError: (_error, _variables, context) => {
      context?.previousBooks.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data)
      })
      if (context?.previousDetails) {
        queryClient.setQueryData(
          ['book', context.id, 'details'],
          context.previousDetails,
        )
      }
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries(bookPageQueries)
      void queryClient.invalidateQueries({
        queryKey: ['book', id, 'details'],
      })
    },
  })

  const changeBatchStatus = useMutation({
    mutationFn: () => booksApi.bulkStatus(Array.from(selected), batchStatus),
    onSuccess: () => {
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const details = useQuery({
    queryKey: ['book', detailsBook?.id, 'details'],
    queryFn: ({ signal }) => booksApi.details(detailsBook!.id, signal),
    enabled: !!detailsBook,
  })

  const updateDetails = useMutation({
    mutationFn: ({ id, input }: { id: string; input: BookDetailsInput }) =>
      booksApi.updateDetails(id, input),
    onSuccess: (result) => {
      queryClient.setQueryData(['book', result.id, 'details'], result)
      setEditingDetails(false)
      setDetailsForm(formFromDetails(result))
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const refreshDetails = useMutation({
    mutationFn: (bookId: string) => booksApi.refreshDetails(bookId),
    onSuccess: (result) => {
      queryClient.setQueryData(['book', result.id, 'details'], result)
      queryClient.setQueriesData<BookPage>(bookPageQueries, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((book) =>
                book.id === result.id
                  ? {
                      ...book,
                      title: result.title,
                      author: result.author ?? undefined,
                      genres: result.genres,
                      hasCover: result.hasCover,
                    }
                  : book,
              ),
            }
          : current,
      )
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const updateCover = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      booksApi.updateCover(id, file),
    onSuccess: (result) => {
      queryClient.setQueryData(['book', result.id, 'details'], result)
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const removeBook = useMutation({
    mutationFn: (bookId: string) => booksApi.remove(bookId),
    onSuccess: (_, bookId) => {
      setDeleting(null)
      setDetailsBook(null)
      setSelected((current) => {
        const next = new Set(current)
        next.delete(bookId)
        return next
      })
      localStorage.removeItem(`reader-progress:${bookId}`)
      queryClient.removeQueries({ queryKey: ['book', bookId] })
      if (query.data?.items.length === 1 && page > 0)
        setPage((value) => value - 1)
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const saveCollection = useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      id
        ? booksApi.renameCollection(id, name)
        : booksApi.createCollection(name),
    onSuccess: () => {
      setCollectionEditor(null)
      setCollectionName('')
      setConfirmCollectionDelete(false)
      void queryClient.invalidateQueries({ queryKey: ['book-collections'] })
    },
  })

  const removeCollection = useMutation({
    mutationFn: (id: string) => booksApi.removeCollection(id),
    onSuccess: (_, id) => {
      if (collection === id) {
        setCollection('all')
        setPage(0)
      }
      setCollectionEditor(null)
      setConfirmCollectionDelete(false)
      void queryClient.invalidateQueries({ queryKey: ['book-collections'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })

  const moveBooks = useMutation({
    mutationFn: ({
      ids,
      collectionId,
    }: {
      ids: string[]
      collectionId: string | null
    }) => booksApi.moveToCollection(ids, collectionId),
    onSuccess: (_, { ids, collectionId }) => {
      const moved = new Set(ids)
      queryClient.setQueriesData<BookPage>(bookPageQueries, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((book) =>
                moved.has(book.id) ? { ...book, collectionId } : book,
              ),
            }
          : current,
      )
      setMoveTarget(null)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book-collections'] })
    },
  })

  const openDetails = (book: BookItem) => {
    updateDetails.reset()
    refreshDetails.reset()
    updateCover.reset()
    setEditingDetails(false)
    setDetailsForm(null)
    setDetailsBook(book)
  }

  const openCollectionEditor = (value: BookCollection | 'new') => {
    saveCollection.reset()
    removeCollection.reset()
    setConfirmCollectionDelete(false)
    setCollectionName(value === 'new' ? '' : value.name)
    setCollectionEditor(value)
  }

  const openMoveDialog = (
    ids: string[],
    label: string,
    current?: string | null,
  ) => {
    moveBooks.reset()
    setMoveCollectionId(current ?? '')
    setMoveTarget({ ids, label })
  }

  const setLibraryView = (next: LibraryView) => {
    setView(next)
    try {
      localStorage.setItem('library-view', next)
    } catch {
      // The selected view remains active for this tab.
    }
  }

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Личная библиотека
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Ваши книги
          </h1>
          <p className="mt-3 max-w-2xl text-muted">
            Продолжайте с сохранённого места и возвращайтесь к важным
            фрагментам.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setUploadOpen(true)}>
          <Plus size={18} />
          Добавить книгу
        </Button>
      </header>

      <section
        aria-label="Коллекции"
        className="mt-7 flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${collection === 'all' ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-secondary hover:border-line-strong'}`}
          onClick={() => {
            setCollection('all')
            setPage(0)
          }}
        >
          Все книги
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${collection === 'none' ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-secondary hover:border-line-strong'}`}
          onClick={() => {
            setCollection('none')
            setPage(0)
          }}
        >
          <Folder size={16} />
          Без коллекции
        </button>
        {collectionItems.map((item) => (
          <div
            key={item.id}
            className={`inline-flex overflow-hidden rounded-xl border transition ${collection === item.id ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-secondary hover:border-line-strong'}`}
          >
            <button
              type="button"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium"
              onClick={() => {
                setCollection(item.id)
                setPage(0)
              }}
            >
              <Folder size={16} />
              <span className="max-w-44 truncate">{item.name}</span>
              <span className="text-xs text-muted">{item.bookCount}</span>
            </button>
            <button
              type="button"
              aria-label={`Настроить коллекцию «${item.name}»`}
              title="Настроить коллекцию"
              className="border-l border-current/15 px-2.5 text-muted transition hover:bg-subtle hover:text-foreground"
              onClick={() => openCollectionEditor(item)}
            >
              <Pencil size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-muted transition hover:border-accent-line hover:bg-accent-soft hover:text-accent"
          onClick={() => openCollectionEditor('new')}
        >
          <FolderPlus size={16} />
          Новая коллекция
        </button>
      </section>

      <section
        aria-label="Поиск и отображение библиотеки"
        className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center"
      >
        <label className="relative min-w-0 flex-1">
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
        <Button
          type="button"
          variant="outline"
          className="relative h-11 shrink-0"
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal size={18} />
          Фильтры
          {activeFilterCount > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-teal-700 px-1.5 py-0.5 text-xs leading-none text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <div
          className="flex shrink-0 rounded-xl border border-line bg-background p-1"
          aria-label="Вид библиотеки"
        >
          <button
            type="button"
            className={`grid h-9 w-10 place-items-center rounded-lg transition ${view === 'grid' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-foreground'}`}
            aria-label="Сеточный вид"
            aria-pressed={view === 'grid'}
            onClick={() => setLibraryView('grid')}
          >
            <Grid2X2 size={17} />
          </button>
          <button
            type="button"
            className={`grid h-9 w-10 place-items-center rounded-lg transition ${view === 'compact' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-foreground'}`}
            aria-label="Компактный список"
            aria-pressed={view === 'compact'}
            onClick={() => setLibraryView('compact')}
          >
            <List size={18} />
          </button>
        </div>
      </section>

      {filtersOpen && (
        <SideDrawer labelledBy="library-filters-title" onClose={closeFilters}>
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <h2 id="library-filters-title" className="text-xl font-semibold">
                Фильтры
              </h2>
              <p className="mt-1 text-sm text-muted">
                Настройте содержимое библиотеки
              </p>
            </div>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition hover:border-accent-line hover:bg-accent-soft hover:text-accent"
              aria-label="Закрыть фильтры"
              onClick={closeFilters}
            >
              <X size={19} />
            </button>
          </header>

          <div
            id="library-filters"
            className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-6"
          >
            <fieldset>
              <legend className="text-sm font-semibold">Книги</legend>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Статус
                  <NativeSelect
                    aria-label="Статус книги"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
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
                  </NativeSelect>
                </label>
                <label className="text-sm font-medium">
                  Формат
                  <NativeSelect
                    aria-label="Формат книги"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={format}
                    onChange={(event) => {
                      setFormat(event.target.value)
                      setPage(0)
                    }}
                  >
                    <option value="all">Все форматы</option>
                    {(facets.data?.formats ?? []).map((value) => (
                      <option key={value} value={value}>
                        {value.toUpperCase()}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Жанр
                  <NativeSelect
                    aria-label="Жанр книги"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={genre}
                    onChange={(event) => {
                      setGenre(event.target.value)
                      setPage(0)
                    }}
                  >
                    <option value="">Все жанры</option>
                    {(facets.data?.genres ?? []).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Избранное
                  <NativeSelect
                    aria-label="Избранные книги"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={favorite}
                    onChange={(event) => {
                      setFavorite(event.target.value as 'all' | 'yes')
                      setPage(0)
                    }}
                  >
                    <option value="all">Все книги</option>
                    <option value="yes">Только избранное</option>
                  </NativeSelect>
                </label>
              </div>
            </fieldset>

            <fieldset className="border-t border-line pt-6">
              <legend className="text-sm font-semibold">Сортировка</legend>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Порядок
                  <NativeSelect
                    aria-label="Сортировка"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as LibrarySort)
                      setPage(0)
                    }}
                  >
                    <option value="recent">Недавно читали</option>
                    <option value="added">По дате добавления</option>
                    <option value="title">По названию</option>
                    <option value="author">По автору</option>
                    <option value="progress">По прогрессу</option>
                    <option value="duration">По времени чтения</option>
                    <option value="size">По объёму</option>
                  </NativeSelect>
                </label>
                <label className="text-sm font-medium">
                  Направление
                  <NativeSelect
                    aria-label="Направление сортировки"
                    containerClassName="mt-2 w-full"
                    className="h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={direction}
                    onChange={(event) => {
                      setDirection(event.target.value as SortDirection)
                      setPage(0)
                    }}
                  >
                    <option value="default">По умолчанию</option>
                    <option value="asc">По возрастанию</option>
                    <option value="desc">По убыванию</option>
                  </NativeSelect>
                </label>
              </div>
            </fieldset>
          </div>

          <footer className="flex gap-3 border-t border-line bg-surface px-5 py-4 sm:px-6">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={activeFilterCount === 0}
              onClick={() => {
                setStatus('all')
                setFormat('all')
                setGenre('')
                setFavorite('all')
                setSort('recent')
                setDirection('default')
                setPage(0)
              }}
            >
              Сбросить
            </Button>
            <Button type="button" className="flex-1" onClick={closeFilters}>
              Показать {query.data?.totalElements ?? 0}
            </Button>
          </footer>
        </SideDrawer>
      )}
      {selected.size > 0 && (
        <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-accent-line bg-accent-soft p-4 sm:flex-row sm:items-center">
          <p className="mr-auto text-sm font-semibold">
            Выбрано книг: {selected.size}
          </p>
          <NativeSelect
            aria-label="Новый статус выбранных книг"
            className="h-10 rounded-xl border border-line bg-surface px-3"
            value={batchStatus}
            onChange={(event) =>
              setBatchStatus(event.target.value as LibraryStatus)
            }
          >
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button
            onClick={() => changeBatchStatus.mutate()}
            disabled={changeBatchStatus.isPending}
          >
            Изменить статус
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              openMoveDialog(
                Array.from(selected),
                `Выбрано книг: ${selected.size}`,
              )
            }
          >
            <FolderInput size={17} />В коллекцию
          </Button>
          <Button variant="outline" onClick={() => setSelected(new Set())}>
            Снять выбор
          </Button>
          {changeBatchStatus.isError && (
            <p className="text-sm text-danger" role="alert">
              {changeBatchStatus.error.message}
            </p>
          )}
        </section>
      )}

      {updateFavorite.isError && (
        <p
          className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          Не удалось изменить избранное: {updateFavorite.error.message}
        </p>
      )}

      {query.isPending ? (
        <p className="mt-8" role="status">
          Загружаем библиотеку…
        </p>
      ) : query.isError ? (
        <div className="mt-8 rounded-2xl bg-danger-soft p-5" role="alert">
          <p>{query.error.message}</p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      ) : query.data.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-10 text-center">
          <LibraryBig className="mx-auto text-muted" size={34} />
          <h2 className="mt-4 text-xl font-semibold">
            {search ||
            status !== 'all' ||
            format !== 'all' ||
            genre ||
            favorite === 'yes' ||
            collection !== 'all'
              ? 'Книги не найдены'
              : 'Библиотека пока пустая'}
          </h2>
          <p className="mt-2 text-muted">
            {search ||
            status !== 'all' ||
            format !== 'all' ||
            genre ||
            favorite === 'yes' ||
            collection !== 'all'
              ? 'Попробуйте изменить поиск или фильтр.'
              : 'Первая загруженная книга появится здесь.'}
          </p>
        </div>
      ) : (
        <div
          className={
            view === 'grid'
              ? 'mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3'
              : 'mt-6 space-y-3'
          }
        >
          {query.data.items.map((book) => {
            const progress = book.textLength
              ? Math.min(
                  100,
                  Math.round((book.positionOffset / book.textLength) * 100),
                )
              : 0
            const ready = ['ready', 'not_started'].includes(book.preparation)
            return (
              <article
                key={book.id}
                className={`document-card group flex overflow-hidden rounded-2xl border bg-surface ${selected.has(book.id) ? 'border-accent-line ring-2 ring-accent-soft' : 'border-line'} ${view === 'grid' ? 'flex-col' : 'flex-col sm:flex-row'}`}
              >
                <Link
                  to={`/library/${book.id}/read`}
                  aria-label={`Открыть книгу «${book.title}»`}
                  className={`flex shrink-0 items-center justify-center overflow-hidden bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-line ${view === 'grid' ? 'h-52 w-full border-b border-line' : 'h-44 w-full sm:h-auto sm:w-32'}`}
                >
                  {book.hasCover ? (
                    <img
                      src={`/api/books/${encodeURIComponent(book.id)}/cover?v=${encodeURIComponent(book.updatedAt)}`}
                      alt={`Обложка книги «${book.title}»`}
                      loading="lazy"
                      className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="rounded-xl bg-surface/80 p-4 text-accent shadow-sm">
                      {book.format === 'manual' ? (
                        <FileText size={24} />
                      ) : (
                        <BookOpen size={24} />
                      )}
                    </span>
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 rounded border-line bg-surface accent-teal-700"
                        checked={selected.has(book.id)}
                        onChange={() => toggleSelected(book.id)}
                        aria-label={`Выбрать книгу «${book.title}»`}
                      />
                      <NativeSelect
                        aria-label={`Статус книги «${book.title}»`}
                        containerClassName="min-w-0 max-w-44 flex-1"
                        className="min-h-8 w-full truncate rounded-full border-0 bg-accent-soft py-1 pl-3 pr-8 text-xs font-semibold text-accent outline-none ring-accent-line focus:ring-2"
                        value={book.libraryStatus}
                        disabled={updateLibrary.isPending}
                        onChange={(event) =>
                          updateLibrary.mutate({
                            book,
                            nextStatus: event.target.value as LibraryStatus,
                          })
                        }
                      >
                        {Object.entries(statuses).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <button
                      type="button"
                      aria-pressed={book.favorite}
                      aria-label={
                        book.favorite
                          ? `Убрать книгу «${book.title}» из избранного`
                          : `Добавить книгу «${book.title}» в избранное`
                      }
                      title={
                        book.favorite ? 'Убрать из избранного' : 'В избранное'
                      }
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line ${book.favorite ? 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/20' : 'text-muted hover:bg-accent-soft hover:text-rose-500'}`}
                      disabled={updateFavorite.isPending}
                      onClick={() =>
                        updateFavorite.mutate({
                          id: book.id,
                          value: !book.favorite,
                        })
                      }
                    >
                      <Heart
                        size={16}
                        fill={book.favorite ? 'currentColor' : 'none'}
                      />
                    </button>
                  </div>
                  <h2
                    className={`${view === 'grid' ? 'mt-3 line-clamp-2' : 'mt-2 line-clamp-2'} text-lg font-semibold leading-snug`}
                  >
                    <Link
                      to={`/library/${book.id}/read`}
                      className="hover:text-accent focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
                    >
                      {book.title}
                    </Link>
                  </h2>
                  <p className="mt-1 line-clamp-1 text-sm text-muted">
                    {book.author || 'Автор не указан'}
                  </p>
                  {!!book.genres.length && view === 'grid' && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {book.genres.slice(0, 3).map((genre) => (
                        <span
                          key={genre}
                          className="rounded-full bg-subtle px-2 py-1 text-[11px] text-muted"
                        >
                          {genre}
                        </span>
                      ))}
                      {book.genres.length > 3 && (
                        <span className="px-1 py-1 text-[11px] text-muted">
                          +{book.genres.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
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
                    {book.collectionId && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder size={14} className="shrink-0" />
                        <dt className="sr-only">Коллекция</dt>
                        <dd className="truncate">
                          {collections.data?.find(
                            (item) => item.id === book.collectionId,
                          )?.name ?? 'Коллекция'}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-auto pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
                      <span>
                        {ready ? `${progress}% прочитано` : 'Подготовка книги…'}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-md bg-subtle px-1.5 py-0.5 font-medium">
                          {book.format.toUpperCase()}
                        </span>
                        {book.fileSizeBytes != null && (
                          <span>{fileSize(book.fileSizeBytes)}</span>
                        )}
                      </span>
                    </div>
                    <div
                      role={ready ? 'progressbar' : undefined}
                      aria-label={
                        ready
                          ? `Прогресс чтения книги «${book.title}»`
                          : undefined
                      }
                      aria-valuenow={ready ? progress : undefined}
                      aria-valuemin={ready ? 0 : undefined}
                      aria-valuemax={ready ? 100 : undefined}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle"
                    >
                      <div
                        className="h-full rounded-full bg-teal-600 transition-[width] duration-500"
                        style={{ width: `${ready ? progress : 8}%` }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <Button
                        asChild
                        className={
                          view === 'grid' ? 'min-w-0 flex-1 px-3' : 'px-4'
                        }
                        variant={ready ? 'default' : 'outline'}
                      >
                        <Link to={`/library/${book.id}/read`}>
                          {ready
                            ? progress
                              ? view === 'grid'
                                ? 'Продолжить'
                                : 'Продолжить чтение'
                              : view === 'grid'
                                ? 'Читать'
                                : 'Начать читать'
                            : 'Открыть подготовку'}
                        </Link>
                      </Button>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`Переместить книгу «${book.title}» в коллекцию`}
                          title={
                            book.collectionId
                              ? `Коллекция: ${collectionItems.find((item) => item.id === book.collectionId)?.name ?? 'Без названия'}`
                              : 'Переместить в коллекцию'
                          }
                          className={`flex size-9 items-center justify-center rounded-lg transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line ${book.collectionId ? 'text-accent' : 'text-muted hover:text-accent'}`}
                          onClick={() =>
                            openMoveDialog(
                              [book.id],
                              book.title,
                              book.collectionId,
                            )
                          }
                        >
                          <FolderInput size={17} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Открыть детали книги «${book.title}»`}
                          title="Детали книги"
                          className="flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
                          onClick={() => openDetails(book)}
                        >
                          <Info size={17} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Удалить книгу «${book.title}»`}
                          title="Удалить книгу"
                          className="flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                          onClick={() => {
                            removeBook.reset()
                            setDeleting(book)
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-7 flex items-center gap-4">
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Назад
          </Button>
          <span className="text-sm text-muted">
            {page + 1} / {query.data.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page + 1 >= query.data.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Далее
          </Button>
        </div>
      )}

      {uploadOpen && (
        <ModalDialog
          labelledBy="library-upload-title"
          onClose={() => setUploadOpen(false)}
          className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <h2 id="library-upload-title" className="text-xl font-semibold">
              Добавить книгу
            </h2>
            <button
              type="button"
              aria-label="Закрыть загрузку книги"
              className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground"
              onClick={() => setUploadOpen(false)}
            >
              <X size={20} />
            </button>
          </header>
          <div className="p-5 sm:p-6">
            <DocumentUpload destination="reader" embedded />
          </div>
        </ModalDialog>
      )}

      {collectionEditor && (
        <ModalDialog
          labelledBy="collection-editor-title"
          closeDisabled={saveCollection.isPending || removeCollection.isPending}
          onClose={() => setCollectionEditor(null)}
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                Коллекция
              </p>
              <h2
                id="collection-editor-title"
                className="mt-2 text-xl font-semibold"
              >
                {collectionEditor === 'new'
                  ? 'Новая коллекция'
                  : 'Настроить коллекцию'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Закрыть настройки коллекции"
              disabled={saveCollection.isPending || removeCollection.isPending}
              className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground disabled:opacity-45"
              onClick={() => setCollectionEditor(null)}
            >
              <X size={19} />
            </button>
          </div>
          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault()
              saveCollection.mutate({
                id:
                  collectionEditor === 'new' ? undefined : collectionEditor.id,
                name: collectionName.trim(),
              })
            }}
          >
            <label className="block text-sm font-medium">
              Название
              <input
                autoFocus
                required
                maxLength={80}
                className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
                value={collectionName}
                onChange={(event) => setCollectionName(event.target.value)}
              />
            </label>
            {saveCollection.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {saveCollection.error.message}
              </p>
            )}
            {removeCollection.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {removeCollection.error.message}
              </p>
            )}
            {confirmCollectionDelete && collectionEditor !== 'new' && (
              <div className="mt-4 rounded-xl bg-danger-soft p-4 text-sm">
                <p>
                  Коллекция будет удалена. Книги останутся в библиотеке без
                  коллекции.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="py-2"
                    onClick={() => setConfirmCollectionDelete(false)}
                  >
                    Отмена
                  </Button>
                  <Button
                    type="button"
                    className="bg-red-700 py-2 hover:bg-red-800"
                    disabled={removeCollection.isPending}
                    onClick={() => removeCollection.mutate(collectionEditor.id)}
                  >
                    {removeCollection.isPending ? 'Удаляем…' : 'Удалить'}
                  </Button>
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-between gap-3">
              {collectionEditor !== 'new' && !confirmCollectionDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-200 text-danger hover:bg-danger-soft"
                  onClick={() => setConfirmCollectionDelete(true)}
                >
                  <Trash2 size={16} />
                  Удалить
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                disabled={saveCollection.isPending || !collectionName.trim()}
              >
                {saveCollection.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </form>
        </ModalDialog>
      )}

      {moveTarget && (
        <ModalDialog
          labelledBy="move-books-title"
          closeDisabled={moveBooks.isPending}
          onClose={() => setMoveTarget(null)}
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                Библиотека
              </p>
              <h2 id="move-books-title" className="mt-2 text-xl font-semibold">
                Переместить в коллекцию
              </h2>
              <p className="mt-2 truncate text-sm text-muted">
                {moveTarget.label}
              </p>
            </div>
            <button
              type="button"
              aria-label="Закрыть выбор коллекции"
              disabled={moveBooks.isPending}
              className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground disabled:opacity-45"
              onClick={() => setMoveTarget(null)}
            >
              <X size={19} />
            </button>
          </div>
          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault()
              moveBooks.mutate({
                ids: moveTarget.ids,
                collectionId: moveCollectionId || null,
              })
            }}
          >
            <label className="block text-sm font-medium">
              Коллекция
              <NativeSelect
                autoFocus
                containerClassName="mt-2 w-full"
                className="h-11 w-full rounded-xl border border-line bg-background pl-3 pr-10 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
                value={moveCollectionId}
                onChange={(event) => setMoveCollectionId(event.target.value)}
              >
                <option value="">Без коллекции</option>
                {collectionItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {collections.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                Не удалось загрузить список коллекций. Обновите страницу и
                попробуйте снова.
              </p>
            )}
            {moveBooks.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {moveBooks.error.message}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={moveBooks.isPending}
                onClick={() => setMoveTarget(null)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={moveBooks.isPending}>
                {moveBooks.isPending ? 'Перемещаем…' : 'Переместить'}
              </Button>
            </div>
          </form>
        </ModalDialog>
      )}

      {detailsBook && (
        <ModalDialog
          labelledBy="book-details-title"
          closeDisabled={updateDetails.isPending}
          onClose={() => setDetailsBook(null)}
          className="max-h-[calc(100vh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl sm:max-h-[calc(100vh-2.5rem)]"
        >
          <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur sm:px-7">
            <h2 id="book-details-title" className="text-xl font-semibold">
              Детали книги
            </h2>
            <button
              type="button"
              aria-label="Закрыть детали книги"
              disabled={updateDetails.isPending}
              className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground disabled:opacity-45"
              onClick={() => setDetailsBook(null)}
            >
              <X size={20} />
            </button>
          </header>

          {details.isPending ? (
            <p className="p-8 text-center text-muted" role="status">
              Загружаем детали книги…
            </p>
          ) : details.isError ? (
            <div className="p-8 text-center" role="alert">
              <p className="text-danger">{details.error.message}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void details.refetch()}
              >
                Повторить
              </Button>
            </div>
          ) : editingDetails && detailsForm ? (
            <form
              className="grid gap-5 p-5 sm:grid-cols-2 sm:p-7"
              onSubmit={(event) => {
                event.preventDefault()
                const optional = (value: string | null) => value?.trim() || null
                updateDetails.mutate({
                  id: detailsBook.id,
                  input: {
                    title: detailsForm.title.trim(),
                    author: optional(detailsForm.author),
                    publisher: optional(detailsForm.publisher),
                    publicationDate: optional(detailsForm.publicationDate),
                    language: optional(detailsForm.language),
                    genres: normalizeGenres(detailsForm.genres),
                    description: optional(detailsForm.description),
                  },
                })
              }}
            >
              <label className="block text-sm font-medium sm:col-span-2">
                Название
                <input
                  autoFocus
                  required
                  maxLength={200}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  value={detailsForm.title}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Автор
                <input
                  maxLength={500}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  value={detailsForm.author ?? ''}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, author: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Издатель
                <input
                  maxLength={500}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  value={detailsForm.publisher ?? ''}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, publisher: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Опубликовано
                <input
                  maxLength={255}
                  placeholder="Например, 2024 или 15.03.2024"
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  value={detailsForm.publicationDate ?? ''}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, publicationDate: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Язык
                <input
                  maxLength={100}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  value={detailsForm.language ?? ''}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, language: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                Жанры
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                  placeholder="Роман, классика, психология"
                  value={detailsForm.genres}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, genres: event.target.value }
                        : current,
                    )
                  }
                />
                <span className="mt-2 block text-xs font-normal text-muted">
                  Разделяйте жанры запятыми. Можно указать до 12 жанров.
                </span>
              </label>
              <label className="block text-sm font-medium sm:col-span-2">
                Описание
                <textarea
                  maxLength={50000}
                  rows={6}
                  className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2"
                  value={detailsForm.description ?? ''}
                  onChange={(event) =>
                    setDetailsForm((current) =>
                      current
                        ? { ...current, description: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
              {updateDetails.isError && (
                <p className="text-sm text-danger sm:col-span-2" role="alert">
                  {updateDetails.error.message}
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={updateDetails.isPending}
                  onClick={() => {
                    setEditingDetails(false)
                    setDetailsForm(
                      details.data ? formFromDetails(details.data) : null,
                    )
                  }}
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={
                    updateDetails.isPending || !detailsForm.title.trim()
                  }
                >
                  {updateDetails.isPending ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </form>
          ) : details.data ? (
            <div className="p-5 sm:p-7">
              <div className="grid gap-6 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start">
                <div className="mx-auto aspect-[2/3] w-36 overflow-hidden rounded-xl bg-accent-soft shadow-sm sm:mx-0 sm:w-full">
                  {details.data.hasCover ? (
                    <img
                      src={`/api/books/${encodeURIComponent(details.data.id)}/cover?v=${encodeURIComponent(details.data.updatedAt)}`}
                      alt={`Обложка книги «${details.data.title}»`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-accent">
                      <BookOpen size={38} />
                    </span>
                  )}
                </div>
                <div className="min-w-0 text-center sm:text-left">
                  <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {details.data.title}
                  </h3>
                  <p className="mt-2 text-muted">
                    {details.data.author || 'Не указано'}
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => {
                        updateDetails.reset()
                        setDetailsForm(formFromDetails(details.data))
                        setEditingDetails(true)
                      }}
                    >
                      <Pencil size={16} />
                      Редактировать
                    </Button>
                    <Button asChild variant="outline">
                      <a
                        href={booksApi.originalDownloadUrl(details.data.id)}
                        download
                      >
                        <Download size={16} />
                        Скачать оригинал
                      </a>
                    </Button>
                    <Button asChild variant="outline">
                      <label className="cursor-pointer">
                        <Upload size={16} />
                        {details.data.hasCover
                          ? 'Заменить обложку'
                          : 'Загрузить обложку'}
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/jpeg,image/png,image/gif"
                          disabled={updateCover.isPending}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            if (file) {
                              updateCover.reset()
                              updateCover.mutate({
                                id: details.data.id,
                                file,
                              })
                            }
                          }}
                        />
                      </label>
                    </Button>
                    <Button
                      variant="outline"
                      disabled={updateFavorite.isPending}
                      onClick={() =>
                        updateFavorite.mutate({
                          id: details.data.id,
                          value: !details.data.favorite,
                        })
                      }
                    >
                      <Heart
                        size={16}
                        fill={details.data.favorite ? 'currentColor' : 'none'}
                      />
                      {details.data.favorite
                        ? 'Убрать из избранного'
                        : 'В избранное'}
                    </Button>
                    <Button
                      variant="outline"
                      title="Обновить метаданные из файла"
                      aria-label="Обновить метаданные из файла"
                      disabled={refreshDetails.isPending}
                      onClick={() => refreshDetails.mutate(details.data.id)}
                    >
                      <RefreshCw
                        size={16}
                        className={
                          refreshDetails.isPending ? 'animate-spin' : undefined
                        }
                      />
                      {refreshDetails.isPending
                        ? 'Обновляем…'
                        : 'Обновить из файла'}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-red-200 text-danger hover:bg-danger-soft"
                      onClick={() => {
                        setDetailsBook(null)
                        setDeleting({
                          id: details.data.id,
                          title: details.data.title,
                        })
                      }}
                    >
                      <Trash2 size={16} />
                      Удалить
                    </Button>
                  </div>
                  {refreshDetails.isError && (
                    <p className="mt-3 text-sm text-danger" role="alert">
                      {refreshErrorMessage(refreshDetails.error)}
                    </p>
                  )}
                  {refreshDetails.isSuccess && (
                    <p className="mt-3 text-sm text-success" role="status">
                      Метаданные обновлены из исходного файла.
                    </p>
                  )}
                  {updateCover.isError && (
                    <p className="mt-3 text-sm text-danger" role="alert">
                      {updateCover.error.message}
                    </p>
                  )}
                  {updateCover.isSuccess && (
                    <p className="mt-3 text-sm text-success" role="status">
                      Обложка книги обновлена.
                    </p>
                  )}
                </div>
              </div>

              <dl className="mt-7 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Издатель', details.data.publisher || 'Не указано'],
                  ['Опубликовано', detailsDate(details.data.publicationDate)],
                  ['Обновлено', detailsDate(details.data.updatedAt)],
                  ['Добавлено', detailsDate(details.data.createdAt)],
                  ['Язык', languageDisplayName(details.data.language)],
                  [
                    'Жанры',
                    details.data.genres.length
                      ? details.data.genres.join(', ')
                      : 'Не указано',
                  ],
                  [
                    'Коллекция',
                    details.data.collectionId
                      ? (collections.data?.find(
                          (item) => item.id === details.data.collectionId,
                        )?.name ?? 'Неизвестная коллекция')
                      : 'Без коллекции',
                  ],
                  ['Формат', details.data.format.toUpperCase()],
                  ['Размер файла', fileSize(details.data.fileSizeBytes)],
                  ['Имя файла', details.data.filename || 'Не указано'],
                  [
                    'Разделы',
                    details.data.sectionCount.toLocaleString('ru-RU'),
                  ],
                  [
                    'Изображения',
                    details.data.assetCount.toLocaleString('ru-RU'),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 bg-surface p-4">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm">{value}</dd>
                  </div>
                ))}
              </dl>

              <section className="mt-7">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Описание
                </h3>
                <p className="mt-2 whitespace-pre-wrap leading-7 text-secondary">
                  {details.data.description || 'Не указано'}
                </p>
              </section>
            </div>
          ) : null}
        </ModalDialog>
      )}

      {deleting && (
        <ModalDialog
          role="alertdialog"
          labelledBy="delete-book-title"
          describedBy="delete-book-description"
          closeDisabled={removeBook.isPending}
          onClose={() => setDeleting(null)}
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-danger">
                Удаление книги
              </p>
              <h2
                id="delete-book-title"
                className="mt-2 line-clamp-2 text-xl font-semibold"
              >
                {deleting.title}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Закрыть подтверждение удаления"
              disabled={removeBook.isPending}
              className="rounded-lg p-2 text-muted transition hover:bg-subtle hover:text-foreground disabled:opacity-45"
              onClick={() => setDeleting(null)}
            >
              <X size={19} />
            </button>
          </div>
          <p id="delete-book-description" className="mt-5 text-sm text-muted">
            Книга, исходный файл, прогресс чтения, закладки и заметки будут
            удалены без возможности восстановления.
          </p>
          {removeBook.isError && (
            <p className="mt-4 text-sm text-danger" role="alert">
              {removeBook.error.message}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              autoFocus
              disabled={removeBook.isPending}
              onClick={() => setDeleting(null)}
            >
              Отмена
            </Button>
            <Button
              className="bg-red-700 hover:bg-red-800"
              disabled={removeBook.isPending}
              onClick={() => removeBook.mutate(deleting.id)}
            >
              {removeBook.isPending ? 'Удаляем…' : 'Удалить книгу'}
            </Button>
          </div>
        </ModalDialog>
      )}
    </>
  )
}
