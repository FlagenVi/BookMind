import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Eye, Plus, Trash2 } from 'lucide-react'
import {
  materialsApi,
  type MaterialContextMode,
  type MaterialContextSummary,
} from '../api/materials'
import type { MaterialSection, MaterialType } from '../api/documents'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'

const labels: Record<MaterialContextMode, string> = {
  full_document: 'Весь документ',
  selected_sections: 'Выбранные разделы',
  selected_fragment: 'Выбранный фрагмент',
  read_to_position: 'До текущего места',
  current_chapter: 'Текущая глава',
  whole_book: 'Вся книга',
}

export function MaterialContexts({
  materialId,
  materialType,
  sections,
}: {
  materialId: string
  materialType: MaterialType
  sections: MaterialSection[]
}) {
  const client = useQueryClient()
  const modes = useMemo<MaterialContextMode[]>(
    () =>
      materialType === 'BOOK'
        ? [
            'read_to_position',
            'current_chapter',
            'selected_sections',
            'selected_fragment',
            'whole_book',
          ]
        : ['full_document', 'selected_sections', 'selected_fragment'],
    [materialType],
  )
  const [mode, setMode] = useState<MaterialContextMode>(modes[0])
  const [title, setTitle] = useState('')
  const [selectedSections, setSelectedSections] = useState<number[]>([])
  const [startOffset, setStartOffset] = useState('0')
  const [endOffset, setEndOffset] = useState('')
  const [includeUnread, setIncludeUnread] = useState(false)
  const [opened, setOpened] = useState<MaterialContextSummary | null>(null)
  const list = useQuery({
    queryKey: ['materials', materialId, 'contexts'],
    queryFn: ({ signal }) => materialsApi.contexts(materialId, signal),
  })
  const details = useQuery({
    queryKey: ['materials', materialId, 'contexts', opened?.id],
    queryFn: ({ signal }) =>
      materialsApi.context(materialId, opened!.id, signal),
    enabled: !!opened,
  })
  const create = useMutation({
    mutationFn: () =>
      materialsApi.createContext(materialId, {
        mode,
        title: title.trim() || undefined,
        sectionNumbers:
          mode === 'selected_sections' ? selectedSections : undefined,
        startOffset:
          mode === 'selected_fragment' ? Number(startOffset) : undefined,
        endOffset: mode === 'selected_fragment' ? Number(endOffset) : undefined,
        includeUnread: mode === 'whole_book' ? includeUnread : undefined,
      }),
    onSuccess: (context) => {
      void client.invalidateQueries({
        queryKey: ['materials', materialId, 'contexts'],
      })
      setOpened({ ...context, contentLength: context.content.length })
      setTitle('')
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => materialsApi.removeContext(materialId, id),
    onSuccess: (_, id) => {
      if (opened?.id === id) setOpened(null)
      void client.invalidateQueries({
        queryKey: ['materials', materialId, 'contexts'],
      })
    },
  })
  const invalid =
    (mode === 'selected_sections' && selectedSections.length === 0) ||
    (mode === 'selected_fragment' &&
      (!Number.isFinite(Number(startOffset)) ||
        !Number.isFinite(Number(endOffset)) ||
        Number(endOffset) <= Number(startOffset))) ||
    (mode === 'whole_book' && !includeUnread)

  return (
    <section>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-accent-soft p-2 text-accent">
            <Archive size={20} />
          </span>
          <div>
            <h2 className="font-semibold">Сохранить контекст</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Создаётся неизменяемый снимок текста и текущей позиции. Он не
              изменится, когда чтение продолжится.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Режим
            <NativeSelect
              className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as MaterialContextMode)
                setIncludeUnread(false)
                create.reset()
              }}
            >
              {modes.map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="text-sm font-medium">
            Название снимка
            <input
              maxLength={200}
              className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
              placeholder={labels[mode]}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </div>
        {mode === 'selected_sections' && (
          <fieldset className="mt-4 rounded-xl bg-page p-4">
            <legend className="px-1 text-sm font-medium">Разделы</legend>
            <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
              {sections.map((section) => (
                <label
                  key={section.number}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle"
                >
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(section.number)}
                    onChange={(event) =>
                      setSelectedSections((current) =>
                        event.target.checked
                          ? [...current, section.number]
                          : current.filter((value) => value !== section.number),
                      )
                    }
                  />
                  {section.title}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {mode === 'selected_fragment' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Начальное смещение
              <input
                type="number"
                min={0}
                className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                value={startOffset}
                onChange={(event) => setStartOffset(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Конечное смещение
              <input
                type="number"
                min={1}
                className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                value={endOffset}
                onChange={(event) => setEndOffset(event.target.value)}
              />
            </label>
          </div>
        )}
        {mode === 'whole_book' && (
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeUnread}
              onChange={(event) => setIncludeUnread(event.target.checked)}
            />
            Я явно разрешаю использовать непрочитанную часть книги. Контекст
            может содержать спойлеры.
          </label>
        )}
        <Button
          className="mt-5"
          disabled={invalid || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus size={16} />
          {create.isPending ? 'Сохраняем…' : 'Создать снимок'}
        </Button>
        {create.isError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {create.error.message}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <h2 className="font-semibold">Сохранённые контексты</h2>
        {list.isPending ? (
          <p role="status" className="text-sm text-muted">
            Загружаем контексты…
          </p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-danger">
            {list.error.message}
          </p>
        ) : list.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
            Снимков пока нет.
          </p>
        ) : (
          list.data.map((context) => (
            <article
              key={context.id}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{context.title}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {labels[context.mode]} ·{' '}
                    {context.contentLength.toLocaleString('ru-RU')} символов
                    {context.progressPercent != null
                      ? ` · позиция ${context.progressPercent.toFixed(1)}%`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(context.createdAt).toLocaleString('ru-RU')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="px-3 py-2"
                    onClick={() => setOpened(context)}
                  >
                    <Eye size={15} /> Открыть
                  </Button>
                  <Button
                    variant="outline"
                    className="px-3 py-2 text-danger"
                    aria-label={`Удалить контекст «${context.title}»`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(context.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {opened && (
        <div className="mt-5 rounded-2xl border border-accent-line bg-accent-soft/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">{opened.title}</h2>
              <p className="mt-1 text-xs text-muted">
                Снимок исходника от{' '}
                {new Date(opened.sourceUpdatedAt).toLocaleString('ru-RU')}
              </p>
            </div>
            <Button variant="outline" onClick={() => setOpened(null)}>
              Закрыть
            </Button>
          </div>
          {details.isPending ? (
            <p role="status" className="mt-4 text-sm">
              Загружаем снимок…
            </p>
          ) : details.isError ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {details.error.message}
            </p>
          ) : (
            <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl bg-page p-4 font-sans text-sm leading-7">
              {details.data.content}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}
