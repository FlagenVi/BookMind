import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileUp, RotateCcw, X } from 'lucide-react'
import {
  documentsApi,
  type ImportReport,
  type MaterialType,
} from '../api/documents'
import { findUploadSession } from '../uploads/uploadSessions'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'

type UploadPhase =
  'waiting' | 'resumable' | 'uploading' | 'importing' | 'done' | 'error'

interface UploadItem {
  key: string
  file: File
  materialType: MaterialType
  phase: UploadPhase
  transferProgress: number
  importProgress: number
  sessionId?: string
  message?: string
  report?: ImportReport
}

const supported = /\.(txt|md|epub|fb2|pdf|docx)$/i
const bookOnly = /\.(epub|fb2)$/i
const maxSize = 30 * 1024 * 1024

export function DocumentUpload({
  destination = 'document',
  embedded = false,
}: {
  destination?: 'document' | 'reader'
  embedded?: boolean
}) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const client = useQueryClient()
  const navigate = useNavigate()

  const updateItem = (key: string, patch: Partial<UploadItem>) =>
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )

  const defaultType = (file: File): MaterialType =>
    bookOnly.test(file.name) || destination === 'reader' ? 'BOOK' : 'DOCUMENT'

  const addFiles = async (selectedFiles: File[]) => {
    setError('')
    const accepted: UploadItem[] = []
    const rejected: string[] = []
    for (const file of selectedFiles) {
      if (!supported.test(file.name)) {
        rejected.push(`${file.name}: неподдерживаемый формат`)
        continue
      }
      if (file.size === 0) {
        rejected.push(`${file.name}: файл пуст`)
        continue
      }
      if (file.size > maxSize) {
        rejected.push(`${file.name}: размер больше 30 МБ`)
        continue
      }
      const materialType = defaultType(file)
      const key = `${file.name}:${file.size}:${file.lastModified}`
      const saved = await findUploadSession(file, materialType).catch(
        () => undefined,
      )
      accepted.push({
        key,
        file,
        materialType,
        phase: saved ? 'resumable' : 'waiting',
        transferProgress: saved?.transferProgress ?? 0,
        importProgress: saved?.importProgress ?? 0,
        sessionId: saved?.sessionId,
        message: saved ? 'Найдена незавершённая загрузка' : undefined,
      })
    }
    setItems((current) => {
      const keys = new Set(current.map((item) => item.key))
      return [...current, ...accepted.filter((item) => !keys.has(item.key))]
    })
    if (rejected.length) setError(rejected.join('. '))
  }

  const changeType = async (item: UploadItem, materialType: MaterialType) => {
    const saved = await findUploadSession(item.file, materialType).catch(
      () => undefined,
    )
    updateItem(item.key, {
      materialType,
      phase: saved ? 'resumable' : 'waiting',
      transferProgress: saved?.transferProgress ?? 0,
      importProgress: saved?.importProgress ?? 0,
      sessionId: saved?.sessionId,
      message: saved ? 'Найдена незавершённая загрузка' : undefined,
    })
  }

  const startQueue = async () => {
    const pending = items.filter((item) =>
      ['waiting', 'resumable', 'error'].includes(item.phase),
    )
    if (!pending.length) return
    setRunning(true)
    setError('')
    const completed: Array<{
      id: string
      materialType: MaterialType
      report?: ImportReport
    }> = []
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++]
        updateItem(item.key, { phase: 'uploading', message: undefined })
        try {
          const result = await documentsApi.uploadResumable(
            item.file,
            item.materialType,
            {
              onTransfer: (transferProgress) =>
                updateItem(item.key, { transferProgress }),
              onSession: (sessionId) => updateItem(item.key, { sessionId }),
              onImport: (session) =>
                updateItem(item.key, {
                  phase:
                    session.status === 'failed'
                      ? 'error'
                      : session.status === 'completed'
                        ? 'done'
                        : 'importing',
                  importProgress: session.importProgress,
                  message: session.errorMessage ?? undefined,
                  report: session.report,
                }),
            },
          )
          completed.push(result)
          updateItem(item.key, {
            phase: 'done',
            transferProgress: 100,
            importProgress: 100,
            report: result.report,
          })
        } catch (reason) {
          updateItem(item.key, {
            phase: 'error',
            message:
              reason instanceof Error
                ? reason.message
                : 'Не удалось загрузить файл',
          })
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(2, pending.length) }, () => worker()),
    )
    setRunning(false)
    await Promise.all([
      client.invalidateQueries({ queryKey: ['documents'] }),
      client.invalidateQueries({ queryKey: ['books'] }),
      client.invalidateQueries({ queryKey: ['me'] }),
    ])
    if (pending.length === 1 && completed.length === 1) {
      const result = completed[0]
      navigate(
        result.materialType === 'BOOK'
          ? `/library/${result.id}/read`
          : `/documents/${result.id}`,
      )
    }
  }

  return (
    <section
      className={
        embedded
          ? ''
          : 'mt-8 rounded-2xl border border-dashed border-accent-line bg-accent-soft/50 p-5'
      }
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <FileUp size={20} />
        {embedded
          ? 'Выберите книги или документы'
          : 'Загрузить книги или документы'}
      </h2>
      <p id="upload-help" className="mt-2 text-sm text-secondary">
        EPUB, FB2, TXT, MD, PDF и DOCX — до 30 МБ каждый. Можно выбрать
        несколько файлов; одновременно загружаются не более двух.
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault()
          void startQueue()
        }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <input
            aria-label="Выберите файлы EPUB, FB2, TXT, MD, PDF или DOCX"
            aria-describedby="upload-help"
            type="file"
            multiple
            accept=".txt,.md,.epub,.fb2,.pdf,.docx,text/plain,text/markdown,application/pdf,application/epub+zip,application/x-fictionbook+xml,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={running}
            className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-accent"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void addFiles(files)
            }}
          />
          <Button
            disabled={running || !items.some((item) => item.phase !== 'done')}
          >
            {running
              ? 'Очередь обрабатывается…'
              : `Загрузить${items.length ? ` (${items.filter((item) => item.phase !== 'done').length})` : ''}`}
          </Button>
        </div>

        {items.length > 0 && (
          <ul className="mt-4 space-y-3" aria-label="Очередь загрузки">
            {items.map((item) => (
              <li
                key={item.key}
                className="rounded-xl border border-line bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-secondary">
                      {(item.file.size / 1024 / 1024).toFixed(1)} МБ
                      {item.phase === 'resumable' && ' · можно продолжить'}
                      {item.phase === 'done' && ' · готово'}
                    </p>
                  </div>
                  {!bookOnly.test(item.file.name) && (
                    <NativeSelect
                      aria-label={`Тип материала ${item.file.name}`}
                      className="min-h-9 rounded-lg border border-line bg-surface px-3 text-sm"
                      value={item.materialType}
                      disabled={running || item.phase === 'done'}
                      onChange={(event) =>
                        void changeType(
                          item,
                          event.target.value as MaterialType,
                        )
                      }
                    >
                      <option value="DOCUMENT">Документ</option>
                      <option value="BOOK">Книга</option>
                    </NativeSelect>
                  )}
                  {item.phase === 'error' && (
                    <button
                      type="button"
                      title="Повторить"
                      className="rounded-lg p-2 text-accent"
                      disabled={running}
                      onClick={() => void startQueue()}
                    >
                      <RotateCcw size={17} />
                    </button>
                  )}
                  {!running && item.phase !== 'done' && (
                    <button
                      type="button"
                      title="Убрать из очереди"
                      className="rounded-lg p-2 text-secondary"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((value) => value.key !== item.key),
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
                {['uploading', 'importing', 'done'].includes(item.phase) && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <UploadProgress
                      label="Передача"
                      value={item.transferProgress}
                    />
                    <UploadProgress
                      label="Импорт"
                      value={item.importProgress}
                    />
                  </div>
                )}
                {item.message && (
                  <p
                    role={item.phase === 'error' ? 'alert' : 'status'}
                    className={`mt-2 text-xs ${item.phase === 'error' ? 'text-danger' : 'text-secondary'}`}
                  >
                    {item.message}
                  </p>
                )}
                {item.phase === 'done' && item.report && (
                  <ImportSummary report={item.report} />
                )}
              </li>
            ))}
          </ul>
        )}
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

function UploadProgress({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-secondary">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <progress
        aria-label={label}
        className="mt-1 h-1.5 w-full accent-teal-700"
        max={100}
        value={value}
      />
    </div>
  )
}

function ImportSummary({ report }: { report: ImportReport }) {
  const skippedChapters = Math.max(
    0,
    report.expectedSpineItems - report.importedSpineItems,
  )
  const issues = [
    skippedChapters ? `пропущено глав: ${skippedChapters}` : '',
    report.missingImages
      ? `не найдено изображений: ${report.missingImages}`
      : '',
    report.skippedTocEntries
      ? `пропущено пунктов оглавления: ${report.skippedTocEntries}`
      : '',
    ...report.metadataWarnings,
  ].filter(Boolean)
  return (
    <p className="mt-2 text-xs text-secondary">
      Импортировано разделов: {report.importedSections}, изображений:{' '}
      {report.importedImages}
      {report.expectedSpineItems > 0 &&
        `, глав EPUB: ${report.importedSpineItems} из ${report.expectedSpineItems}`}
      .{issues.length > 0 && ` Замечания: ${issues.join('; ')}.`}
    </p>
  )
}
