import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Eye, EyeOff, FilePlus2, GripVertical, Pencil, Save, Trash2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { booksApi } from '../api/books'
import {
  novelsApi,
  type NovelChapter,
  type NovelPreviewChapter,
} from '../api/novels'
import { Button } from '../components/ui/button'

const formats = '.txt,.md,.docx,.html,.xhtml,.epub,.fb2'

function move<T>(values: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= values.length) return values
  const result = [...values]
  ;[result[index], result[target]] = [result[target], result[index]]
  return result
}

function fileLabel(count: number) {
  return count === 1 ? '1 файл' : `${count} файлов`
}

function SortableChapterRow({ chapter, index, count, busy, confirmingDelete, onTitleChange, onMove, onDelete, onConfirmDelete, onCancelDelete }: {
  chapter: NovelChapter
  index: number
  count: number
  busy: boolean
  confirmingDelete: boolean
  onTitleChange: (value: string) => void
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id, disabled: busy })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-xl border bg-page ${isDragging ? 'z-10 border-accent-line shadow-lg' : 'border-line'}`}
    >
      <div className="flex min-w-0 items-center gap-2 p-2 sm:gap-3 sm:p-3">
        <button
          type="button"
          className="grid size-11 shrink-0 cursor-grab place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent active:cursor-grabbing disabled:opacity-40"
          style={{ touchAction: 'none' }}
          disabled={busy}
          aria-label={`Перетащить главу ${index + 1}: ${chapter.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={19} />
        </button>
        <span className="w-7 shrink-0 text-center text-sm tabular-nums text-muted">{index + 1}</span>
        <input
          aria-label={`Название главы ${index + 1}`}
          maxLength={500}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 font-medium text-foreground focus-visible:border-accent-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
          value={chapter.title}
          disabled={busy}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <div className="hidden shrink-0 gap-1 sm:flex">
          <button type="button" aria-label={`Поднять главу ${index + 1}`} disabled={index === 0 || busy} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-35" onClick={() => onMove(-1)}><ArrowUp size={18} /></button>
          <button type="button" aria-label={`Опустить главу ${index + 1}`} disabled={index === count - 1 || busy} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-35" onClick={() => onMove(1)}><ArrowDown size={18} /></button>
        </div>
        <button type="button" aria-label={`Удалить главу ${index + 1}: ${chapter.title}`} disabled={count === 1 || busy} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-35" onClick={onDelete}><Trash2 size={18} /></button>
      </div>
      {confirmingDelete && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
          <span className="text-danger">Удалить главу и её заметки? Это действие нельзя отменить.</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancelDelete}>Отмена</Button>
            <Button variant="outline" className="border-danger text-danger hover:bg-danger-soft" disabled={busy} onClick={onConfirmDelete}>Удалить</Button>
          </div>
        </div>
      )}
    </li>
  )
}

export function NovelChaptersPage({ embedded = false }: { embedded?: boolean }) {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<NovelPreviewChapter[] | null>(null)
  const [draft, setDraft] = useState<NovelChapter[] | null>(null)
  const [insertAt, setInsertAt] = useState(-1)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const chaptersQuery = useQuery({
    queryKey: ['novel', id, 'chapters'],
    queryFn: ({ signal }) => novelsApi.chapters(id!, signal),
    enabled: !!id,
  })
  const detailsQuery = useQuery({
    queryKey: ['book', id, 'details'],
    queryFn: ({ signal }) => booksApi.details(id!, signal),
    enabled: !!id,
  })
  const previewMutation = useMutation({
    mutationFn: () => novelsApi.preview(files),
    onSuccess: (result) => {
      setPreview(result.chapters)
      setError('')
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const commitMutation = useMutation({
    mutationFn: () =>
      isNew
        ? novelsApi.create(title, author, files, preview!)
        : novelsApi.add(id!, files, preview!, insertAt < 0 ? existing.length : insertAt),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['books'] })
      await queryClient.invalidateQueries({ queryKey: ['novel', result.id] })
      await queryClient.invalidateQueries({ queryKey: ['book', result.id] })
      setDraft(result.chapters)
      setInsertAt(-1)
      setFiles([])
      setPreview(null)
      if (fileInput.current) fileInput.current.value = ''
      if (isNew) navigate(`/library/${result.id}/chapters`, { replace: true })
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const orderMutation = useMutation({
    mutationFn: () => novelsApi.reorder(id!, draft!),
    onSuccess: async (result) => {
      queryClient.setQueryData(['novel', id, 'chapters'], result.chapters)
      setDraft(null)
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: ['novel', result.id] })
      await queryClient.invalidateQueries({ queryKey: ['book', result.id] })
      await queryClient.invalidateQueries({ queryKey: ['books'] })
      setError('')
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const readMutation = useMutation({
    mutationFn: ({ chapterId, read }: { chapterId: string; read: boolean }) => novelsApi.markRead(id!, chapterId, read),
    onSuccess: (chapter) => {
      queryClient.setQueryData<NovelChapter[]>(['novel', id, 'chapters'], (current) =>
        current?.map((item) => item.id === chapter.id ? chapter : item),
      )
      setError('')
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const removeMutation = useMutation({
    mutationFn: (chapterId: string) => novelsApi.remove(id!, chapterId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['novel', id, 'chapters'], result.chapters)
      setDraft((current) => {
        if (!current) return null
        const remaining = new Map(result.chapters.map((chapter) => [chapter.id, chapter]))
        return current.filter((chapter) => remaining.has(chapter.id))
          .map((chapter) => ({ ...remaining.get(chapter.id)!, title: chapter.title }))
      })
      setDeleteTarget(null)
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['novel', id] })
      await queryClient.invalidateQueries({ queryKey: ['book', id] })
      await queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const busy = previewMutation.isPending || commitMutation.isPending || orderMutation.isPending || removeMutation.isPending
  const existing = draft ?? chaptersQuery.data ?? []
  const orderChanged =
    !isNew &&
    JSON.stringify(existing.map(({ id: chapterId, title: chapterTitle }) => [chapterId, chapterTitle])) !==
      JSON.stringify((chaptersQuery.data ?? []).map(({ id: chapterId, title: chapterTitle }) => [chapterId, chapterTitle]))

  const Container = embedded ? 'div' : 'main'
  const Heading = embedded ? 'h3' : 'h1'
  return (
    <Container className={embedded ? 'w-full' : 'mx-auto w-full max-w-5xl px-4 pb-16 pt-7 sm:px-6'}>
      {!embedded && (
        <Link
          to="/library"
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent"
        >
          <ArrowLeft size={17} /> Вернуться в библиотеку
        </Link>
      )}
      <div className={`${embedded ? '' : 'mt-5'} flex flex-wrap items-start justify-between gap-4`}>
        <div>
          <Heading className="text-3xl font-semibold tracking-tight">
            {isNew ? 'Новая новелла' : `Главы · ${detailsQuery.data?.title ?? 'новелла'}`}
          </Heading>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {isNew ? 'Загрузите первые главы. Потом новеллу можно будет пополнять новыми файлами.' : 'Выберите главу, чтобы читать с её начала, или отметьте прочитанной.'}
          </p>
        </div>
        {!isNew && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowUploader((value) => !value)}><FilePlus2 size={17} /> Добавить главы</Button>
            <Button asChild variant="outline"><Link to={`/library/${id}/read`}><BookOpen size={17} /> Продолжить чтение</Link></Button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-line bg-surface p-3 text-sm text-danger">{error}</p>}

      {isNew && (
        <section className={`${embedded ? 'mt-5' : 'mt-7'} grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2 sm:p-6`} aria-label="Сведения о новелле">
          <label className="grid gap-2 text-sm font-semibold">
            Название новеллы
            <input
              className="min-h-11 w-full rounded-xl border border-line bg-page px-3 font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например, Небесная библиотека"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Автор <span className="text-xs font-normal text-muted">(необязательно)</span>
            <input
              className="min-h-11 w-full rounded-xl border border-line bg-page px-3 font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
              maxLength={500}
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
        </section>
      )}

      {!isNew && (
        <section className="mt-7" aria-label="Главы новеллы">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Список глав</h2>
              {!editing && chaptersQuery.data && <p className="mt-1 text-sm text-muted">Прочитано {chaptersQuery.data.filter((chapter) => chapter.read).length} из {chaptersQuery.data.length}</p>}
              {editing && <p className="mt-1 text-sm text-muted">Перетащите главу за ручку или используйте стрелки. Изменения порядка и названий сохраняются вместе.</p>}
            </div>
            {editing ? (
              <div className="flex gap-2">
                <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setDeleteTarget(null); setEditing(false); setError('') }}>Отмена</Button>
                <Button disabled={!orderChanged || busy || existing.some((chapter) => !chapter.title.trim())} onClick={() => orderMutation.mutate()}><Save size={17} /> Сохранить</Button>
              </div>
            ) : (
              <Button variant="outline" disabled={chaptersQuery.isPending || chaptersQuery.isError} onClick={() => { setDraft(chaptersQuery.data?.map((chapter) => ({ ...chapter })) ?? []); setEditing(true) }}><Pencil size={17} /> Редактировать</Button>
            )}
          </div>
          {chaptersQuery.isPending && <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">Загружаем главы…</p>}
          {chaptersQuery.isError && <p role="alert" className="rounded-xl border border-line bg-surface p-5 text-sm text-danger">{chaptersQuery.error.message}</p>}
          {editing ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return
              const from = existing.findIndex((chapter) => chapter.id === active.id)
              const to = existing.findIndex((chapter) => chapter.id === over.id)
              if (from >= 0 && to >= 0) setDraft(arrayMove(existing, from, to))
            }}>
              <SortableContext items={existing.map((chapter) => chapter.id)} strategy={verticalListSortingStrategy}>
                <ol className="space-y-2">
                  {existing.map((chapter, index) => (
                    <SortableChapterRow
                      key={chapter.id}
                      chapter={chapter}
                      index={index}
                      count={existing.length}
                      busy={busy}
                      confirmingDelete={deleteTarget === chapter.id}
                      onTitleChange={(value) => setDraft(existing.map((item) => item.id === chapter.id ? { ...item, title: value } : item))}
                      onMove={(direction) => setDraft(move(existing, index, direction))}
                      onDelete={() => setDeleteTarget(chapter.id)}
                      onConfirmDelete={() => removeMutation.mutate(chapter.id)}
                      onCancelDelete={() => setDeleteTarget(null)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          ) : (
            <ol className="space-y-2">
              {(chaptersQuery.data ?? []).map((chapter, index) => (
                <li key={chapter.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface p-2 sm:gap-3 sm:p-3">
                  <Link to={`/library/${id}/read?chapter=${chapter.number}`} className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line">
                    <span className="w-8 shrink-0 text-center text-sm tabular-nums text-muted">{index + 1}</span>
                    <span className={`min-w-0 truncate font-medium group-hover:text-accent ${chapter.read ? 'text-secondary' : 'text-foreground'}`}>{chapter.title}</span>
                  </Link>
                  <button
                    type="button"
                    aria-label={chapter.read ? `Отметить главу «${chapter.title}» непрочитанной` : `Отметить главу «${chapter.title}» прочитанной`}
                    title={chapter.read ? 'Прочитана' : 'Не прочитана'}
                    aria-pressed={chapter.read}
                    disabled={readMutation.isPending}
                    onClick={() => readMutation.mutate({ chapterId: chapter.id, read: !chapter.read })}
                    className={`grid size-11 shrink-0 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line disabled:opacity-50 ${chapter.read ? 'bg-accent-soft text-accent hover:bg-subtle' : 'text-muted hover:bg-subtle hover:text-foreground'}`}
                  >
                    {chapter.read ? <Eye size={19} /> : <EyeOff size={19} />}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {(isNew || showUploader) && <section className="mt-6 rounded-2xl border border-line bg-surface p-5 sm:p-6" aria-label="Добавить главы">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><FilePlus2 size={20} /></span>
          <div>
            <h2 className="text-lg font-semibold">{isNew ? 'Первые главы' : 'Добавить главы'}</h2>
            <p className="text-sm text-muted">TXT, MD, DOCX, HTML, XHTML — глава файлом. EPUB и FB2 разбиваются на разделы.</p>
          </div>
        </div>
        <label className="mt-5 grid gap-2 text-sm font-semibold">
          Файлы глав или тома
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={formats}
            className="block w-full rounded-xl border border-dashed border-line-strong bg-page p-3 text-sm font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:font-semibold file:text-accent"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })))
              setPreview(null)
              setError('')
            }}
          />
        </label>
        <p className="mt-2 text-xs text-muted">До 100 файлов и 30 МБ за раз. Изображения из DOCX, EPUB и FB2 сохраняются. Загрузка глав не расходует токены ИИ.</p>
        {!isNew && <p className="mt-2 text-xs text-muted">Если уже есть изложение, после изменения глав оно станет устаревшим. Новый запрос к ИИ запускается только вручную.</p>}
        <Button className="mt-4" variant="outline" disabled={!files.length || busy} onClick={() => previewMutation.mutate()}>
          {previewMutation.isPending ? 'Проверяем файлы…' : `Проверить порядок · ${fileLabel(files.length)}`}
        </Button>

        {preview && (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="font-semibold">Перед сохранением</h3>
            <p className="mt-1 text-sm text-muted">Проверьте названия и порядок. Ненужные разделы тома можно убрать до сохранения.</p>
            <ol className="mt-4 space-y-2">
              {preview.map((chapter, index) => (
                <li key={chapter.key} className="flex items-center gap-3 rounded-xl border border-line bg-page p-3">
                  <span className="w-7 shrink-0 text-center text-sm tabular-nums text-muted">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <input
                      aria-label={`Название новой главы ${index + 1}`}
                      maxLength={500}
                      className="min-h-10 w-full rounded-lg border border-transparent bg-transparent px-2 font-medium focus-visible:border-accent-line focus-visible:outline-none"
                      value={chapter.title}
                      onChange={(event) => setPreview(preview.map((value, position) => position === index ? { ...value, title: event.target.value } : value))}
                    />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`Поднять новую главу ${index + 1}`} disabled={index === 0 || busy} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-35" onClick={() => setPreview(move(preview, index, -1))}><ArrowUp size={18} /></button>
                    <button type="button" aria-label={`Опустить новую главу ${index + 1}`} disabled={index === preview.length - 1 || busy} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-accent disabled:opacity-35" onClick={() => setPreview(move(preview, index, 1))}><ArrowDown size={18} /></button>
                    <button type="button" aria-label={`Убрать новую главу ${index + 1} из загрузки`} disabled={busy} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-35" onClick={() => setPreview(preview.filter((_, position) => position !== index))}><X size={18} /></button>
                  </div>
                </li>
              ))}
            </ol>
            {!isNew && (
              <label className="mt-5 grid max-w-sm gap-2 text-sm font-semibold">
                Поместить новые главы
                <select className="min-h-11 rounded-xl border border-line bg-page px-3 text-foreground" value={insertAt < 0 ? existing.length : insertAt} onChange={(event) => setInsertAt(Number(event.target.value))}>
                  {Array.from({ length: existing.length + 1 }, (_, index) => (
                    <option key={index} value={index}>
                      {index === existing.length ? 'В конец' : `Перед главой ${index + 1}: ${existing[index].title}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button className="mt-5" disabled={busy || !preview.length || (isNew && !title.trim()) || preview.some((chapter) => !chapter.title.trim()) || orderChanged} onClick={() => commitMutation.mutate()}>
              <Save size={17} /> {commitMutation.isPending ? 'Сохраняем…' : isNew ? 'Создать новеллу' : 'Добавить главы'}
            </Button>
            {orderChanged && <p className="mt-2 text-xs text-muted">Сначала сохраните изменения в существующих главах.</p>}
          </div>
        )}
      </section>}
    </Container>
  )
}
