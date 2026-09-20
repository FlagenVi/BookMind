import { useCallback, useDeferredValue, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  FileText,
  LayoutGrid,
  List,
  ListTree,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { documentsApi, type DocumentListFilters } from '../api/documents'
import { SummaryPanel } from '../components/SummaryPanel'
import { ProcessingBadge } from '../components/ProcessingBadge'
import { Button } from '../components/ui/button'
import { ModalDialog } from '../components/ui/modal-dialog'
import { NativeSelect } from '../components/ui/native-select'
import { SideDrawer } from '../components/ui/side-drawer'
import { DocumentOriginalViewer } from '../reader/DocumentOriginalViewer'

type WorkspaceTab = 'content' | 'structure' | 'processing'
type DocumentView = 'grid' | 'list'

function formatFileSize(value: number) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: unit ? 1 : 0 }).format(size)} ${units[unit]}`
}

export function DocumentsPage() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [format, setFormat] = useState('all')
  const [sort, setSort] = useState<DocumentListFilters['sort']>('updated')
  const [direction, setDirection] = useState<DocumentListFilters['direction']>('desc')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  const [view, setView] = useState<DocumentView>(() => {
    try {
      return localStorage.getItem('documents-view') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const changeView = (next: DocumentView) => {
    setView(next)
    try {
      localStorage.setItem('documents-view', next)
    } catch {
      // The choice still works for this visit when browser storage is disabled.
    }
  }
  const filters: DocumentListFilters = { q: deferredSearch, format, sort, direction }
  const activeFilterCount = [format !== 'all', sort !== 'updated', direction !== 'desc'].filter(Boolean).length
  const hasSelection = search.trim().length > 0 || format !== 'all'
  const query = useQuery({
    queryKey: ['documents', 'list', page, filters],
    queryFn: ({ signal }) => documentsApi.list(page, signal, filters),
    refetchInterval: 3000,
  })
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Рабочая область
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Документы</h1>
          <p className="mt-3 text-muted">
            TXT, MD, PDF и DOCX: содержимое, структура и изложение.
          </p>
        </div>
        <Button asChild>
          <Link to="/">Добавить документ</Link>
        </Button>
      </div>
      <section aria-label="Поиск и отображение документов" className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Поиск документов</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} />
          <input
            type="search"
            maxLength={100}
            placeholder="Название или имя файла"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0) }}
            className="h-11 w-full rounded-xl border border-line bg-background pl-10 pr-4 outline-none transition focus:border-accent-line focus:ring-2 focus:ring-accent-soft"
          />
        </label>
        <Button type="button" variant="outline" className="h-11 shrink-0" aria-expanded={filtersOpen} aria-controls="document-filters" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal size={18} /> Фильтры
          {activeFilterCount > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-teal-700 px-1.5 py-0.5 text-xs leading-none text-white">{activeFilterCount}</span>}
        </Button>
        <div role="group" aria-label="Вид списка документов" className="flex shrink-0 rounded-xl border border-line bg-background p-1">
          {([['grid', LayoutGrid, 'Плитка'], ['list', List, 'Список']] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" aria-label={label} aria-pressed={view === value} title={label}
              className={`grid h-9 w-10 place-items-center rounded-lg transition-colors ${view === value ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-subtle hover:text-foreground'}`}
              onClick={() => changeView(value)}><Icon size={18} /></button>
          ))}
        </div>
      </section>
      {filtersOpen && (
        <SideDrawer labelledBy="document-filters-title" onClose={closeFilters}>
          <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div><h2 id="document-filters-title" className="text-xl font-semibold">Фильтры</h2><p className="mt-1 text-sm text-muted">Настройте список документов</p></div>
            <button type="button" aria-label="Закрыть фильтры" className="grid h-10 w-10 place-items-center rounded-xl border border-line text-muted transition hover:border-accent-line hover:bg-accent-soft hover:text-accent" onClick={closeFilters}><X size={19} /></button>
          </header>
          <div id="document-filters" className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-6">
            <label className="block text-sm font-medium">Формат
              <NativeSelect aria-label="Формат документа" containerClassName="mt-2 w-full" className="h-11 w-full rounded-xl border border-line bg-background px-3" value={format} onChange={(event) => { setFormat(event.target.value); setPage(0) }}>
                <option value="all">Все форматы</option><option value="pdf">PDF</option><option value="docx">DOCX</option><option value="txt">TXT</option><option value="md">MD</option><option value="manual">Созданные вручную</option>
              </NativeSelect>
            </label>
            <fieldset className="border-t border-line pt-6"><legend className="text-sm font-semibold">Сортировка</legend>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">Порядок
                  <NativeSelect aria-label="Сортировка документов" containerClassName="mt-2 w-full" className="h-11 w-full rounded-xl border border-line bg-background px-3" value={sort} onChange={(event) => { setSort(event.target.value as DocumentListFilters['sort']); setPage(0) }}>
                    <option value="updated">По обновлению</option><option value="created">По добавлению</option><option value="title">По названию</option><option value="size">По размеру файла</option>
                  </NativeSelect>
                </label>
                <label className="text-sm font-medium">Направление
                  <NativeSelect aria-label="Направление сортировки документов" containerClassName="mt-2 w-full" className="h-11 w-full rounded-xl border border-line bg-background px-3" value={direction} onChange={(event) => { setDirection(event.target.value as DocumentListFilters['direction']); setPage(0) }}>
                    <option value="desc">По убыванию</option><option value="asc">По возрастанию</option>
                  </NativeSelect>
                </label>
              </div>
            </fieldset>
          </div>
          <footer className="flex gap-3 border-t border-line bg-surface px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="flex-1" disabled={activeFilterCount === 0} onClick={() => { setFormat('all'); setSort('updated'); setDirection('desc'); setPage(0) }}>Сбросить</Button>
            <Button type="button" className="flex-1" onClick={closeFilters}>Показать {query.data?.totalElements ?? 0}</Button>
          </footer>
        </SideDrawer>
      )}
      {query.isPending ? (
        <p role="status" className="mt-8">
          Загрузка документов…
        </p>
      ) : query.isError ? (
        <div role="alert" className="mt-8 rounded-xl bg-danger-soft p-5">
          <p>{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      ) : query.data.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-10 text-center">
          <FileText className="mx-auto text-accent" size={28} />
          <h2 className="mt-4 text-xl font-medium">{hasSelection ? 'Документы не найдены' : 'Документов пока нет'}</h2>
          <p className="mt-2 text-muted">
            {hasSelection ? 'Попробуйте изменить запрос или сбросить фильтры.' : 'Добавьте файл или вставьте текст, чтобы создать рабочую область.'}
          </p>
          {hasSelection ? (
            <Button variant="outline" className="mt-5" onClick={() => { setSearch(''); setFormat('all'); setSort('updated'); setDirection('desc'); setPage(0) }}>Сбросить поиск и фильтры</Button>
          ) : (
            <Button asChild className="mt-5"><Link to="/">Добавить материал</Link></Button>
          )}
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted" role="status">
            {hasSelection ? 'Найдено документов' : 'Всего документов'}: {query.data.totalElements.toLocaleString('ru-RU')}
          </p>
          <div className={`mt-4 grid gap-4 ${view === 'grid' ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {query.data.items.map((document) => {
              const format = document.sourceType.toUpperCase()
              return (
                <Link
                  key={document.id}
                  to={`/documents/${document.id}`}
                  className={`document-card group min-w-0 rounded-2xl border border-line bg-surface p-5 text-foreground hover:-translate-y-0.5 hover:border-accent-line hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${view === 'grid' ? 'flex h-full flex-col' : 'sm:flex sm:items-center sm:gap-5'}`}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <span
                      aria-hidden="true"
                      className={`flex shrink-0 flex-col items-center justify-center rounded-xl border border-line-strong bg-page text-accent shadow-sm ${view === 'grid' ? 'h-20 w-16' : 'h-16 w-13'}`}
                    >
                      <FileText size={view === 'grid' ? 25 : 21} strokeWidth={1.7} />
                      <span className="mt-1 text-[10px] font-bold tracking-wide">
                        {format}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-2 break-words text-lg font-semibold leading-6 group-hover:text-accent">
                        {document.title}
                      </h2>
                      {document.originalFilename && (
                        <p className="mt-1 truncate text-xs text-muted" title={document.originalFilename}>
                          {document.originalFilename}
                        </p>
                      )}
                      <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                        {document.pageCount != null && (
                          <span>{document.pageCount} стр.</span>
                        )}
                        {document.fileSizeBytes != null && (
                          <span>{formatFileSize(document.fileSizeBytes)}</span>
                        )}
                        <span>
                          Обновлён{' '}
                          {new Date(document.updatedAt).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </p>
                    </div>
                  </div>
                  {view === 'grid' && (
                    <div className="mt-5 rounded-xl border border-line/70 bg-page/70 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                        Фрагмент
                      </p>
                      <p className="mt-1 line-clamp-2 break-words text-sm leading-6 text-secondary">
                        {document.preview?.trim() || 'Содержимое доступно в рабочей области'}
                      </p>
                    </div>
                  )}
                  <div className={`flex min-w-0 items-center justify-between gap-3 ${view === 'grid' ? 'mt-auto border-t border-line pt-4' : 'mt-4 sm:mt-0 sm:ml-auto sm:shrink-0'}`}>
                    <ProcessingBadge state={document.processing} className="min-w-0" />
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent">
                      Открыть <ArrowUpRight size={17} aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
          {query.data.totalPages > 1 && (
            <div className="mt-6 flex items-center gap-4">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </Button>
              <span className="text-sm">
                {page + 1} / {query.data.totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page + 1 >= query.data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Далее
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

export function DocumentPage() {
  const { id = '' } = useParams()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [textPage, setTextPage] = useState(0)
  const [tab, setTab] = useState<WorkspaceTab>('content')
  const [documentPosition, setDocumentPosition] = useState({
    documentId: '',
    offset: 0,
  })
  const client = useQueryClient()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['documents', 'detail', id],
    queryFn: ({ signal }) => documentsApi.get(id, signal),
  })
  const remove = useMutation({
    mutationFn: () => documentsApi.remove(id),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: ['documents'] })
      client.removeQueries({ queryKey: ['documents', 'detail', id] })
      void client.invalidateQueries({ queryKey: ['documents', 'list'] })
      void client.invalidateQueries({ queryKey: ['me'] })
      navigate('/documents', { replace: true })
    },
  })
  return (
    <>
      <Link to="/documents" className="text-sm text-accent underline">
        ← Ко всем документам
      </Link>
      {query.isPending ? (
        <p role="status" className="mt-8">
          Загрузка рабочей области…
        </p>
      ) : query.isError ? (
        <div role="alert" className="mt-8">
          <p>{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      ) : (
        <div className="mt-6 min-w-0">
          <main className="min-w-0">
            <header className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                    <FileText size={15} /> {query.data.sourceType}
                  </div>
                  <h1 className="mt-3 break-words text-2xl font-semibold">
                    {query.data.title}
                  </h1>
                  <p className="mt-2 text-sm text-muted">
                    {query.data.originalFilename ?? 'Текст создан вручную'} ·{' '}
                    {query.data.content.length.toLocaleString('ru-RU')} символов
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="text-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} /> Удалить
                </Button>
              </div>
              <nav
                aria-label="Разделы рабочей области"
                className="mt-6 flex gap-2 overflow-x-auto border-t border-line pt-4"
              >
                {(
                  [
                    ['content', 'Содержимое', FileText],
                    ['structure', 'Структура', ListTree],
                    ['processing', 'Изложение', Sparkles],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={tab === value}
                    className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${tab === value ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-subtle'}`}
                    onClick={() => setTab(value)}
                  >
                    <Icon size={16} /> {label}
                  </button>
                ))}
              </nav>
            </header>
            <section className="mt-5">
              {tab === 'content' && (
                ['pdf', 'docx'].includes(
                  query.data.sourceType.toLocaleLowerCase('ru-RU'),
                ) ? (
                  <DocumentOriginalViewer
                    key={id}
                    documentId={id}
                    title={query.data.title}
                    sourceType={query.data.sourceType}
                    sections={query.data.sections}
                    textLength={query.data.content.length}
                    activeOffset={
                      documentPosition.documentId === id
                        ? documentPosition.offset
                        : 0
                    }
                    onActiveOffset={(offset) =>
                      setDocumentPosition({ documentId: id, offset })
                    }
                  />
                ) : (
                  <article className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
                    <p className="whitespace-pre-wrap break-words leading-8 text-secondary">
                      {query.data.content.slice(
                        textPage * 10000,
                        (textPage + 1) * 10000,
                      )}
                    </p>
                    {query.data.content.length > 10000 && (
                      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
                        <Button
                          variant="outline"
                          disabled={textPage === 0}
                          onClick={() => setTextPage(textPage - 1)}
                        >
                          Назад по тексту
                        </Button>
                        <span className="text-sm text-muted">
                          Фрагмент {textPage + 1} из{' '}
                          {Math.ceil(query.data.content.length / 10000)}
                        </span>
                        <Button
                          variant="outline"
                          disabled={
                            (textPage + 1) * 10000 >= query.data.content.length
                          }
                          onClick={() => setTextPage(textPage + 1)}
                        >
                          Далее по тексту
                        </Button>
                      </div>
                    )}
                  </article>
                )
              )}
              {tab === 'structure' && (
                <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
                  <h2 className="font-semibold">Структура документа</h2>
                  <div className="mt-4 space-y-2">
                    {query.data.sections.map((section) => (
                      <button
                        key={section.number}
                        type="button"
                        className="flex w-full items-center justify-between gap-4 rounded-xl bg-page px-4 py-3 text-left text-sm transition hover:bg-subtle"
                        onClick={() => {
                          setTextPage(Math.floor(section.startOffset / 10000))
                          setDocumentPosition({
                            documentId: id,
                            offset: section.startOffset,
                          })
                          setTab('content')
                        }}
                      >
                        <span>{section.title}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {section.startOffset.toLocaleString('ru-RU')}–
                          {section.endOffset.toLocaleString('ru-RU')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'processing' && <SummaryPanel id={id} />}
            </section>
          </main>
        </div>
      )}
      {confirmDelete && (
        <ModalDialog
          labelledBy="delete-document-title"
          role="alertdialog"
          closeDisabled={remove.isPending}
          onClose={() => setConfirmDelete(false)}
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        >
            <h2 id="delete-document-title" className="text-lg font-semibold">
              Удалить документ?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Вместе с документом удалятся сохранённые данные и результаты изложения.
              Восстановить их нельзя.
            </p>
            <div className="mt-6 flex gap-3">
              <Button
                className="bg-red-700 hover:bg-red-800"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Удаление…' : 'Удалить'}
              </Button>
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => setConfirmDelete(false)}
              >
                Отмена
              </Button>
            </div>
            {remove.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {remove.error.message}
              </p>
            )}
        </ModalDialog>
      )}
    </>
  )
}
