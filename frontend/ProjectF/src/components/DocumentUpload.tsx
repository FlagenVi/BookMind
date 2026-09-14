import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileUp } from 'lucide-react'
import { documentsApi } from '../api/documents'
import { Button } from './ui/button'

export function DocumentUpload({
  destination = 'document',
}: {
  destination?: 'document' | 'reader'
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [sessionId, setSessionId] = useState<string>()
  const client = useQueryClient()
  const navigate = useNavigate()
  const upload = useMutation({
    mutationFn: (selected: File) =>
      documentsApi.uploadResumable(
        selected,
        setProgress,
        setSessionId,
        sessionId,
      ),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['documents'] })
      void client.invalidateQueries({ queryKey: ['me'] })
      navigate(
        destination === 'reader'
          ? `/library/${result.id}/read`
          : `/history/${result.id}`,
      )
    },
  })
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-accent-line bg-accent-soft/50 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <FileUp size={20} />
        Загрузить книгу или документ
      </h2>
      <p id="upload-help" className="mt-2 text-sm text-secondary">
        EPUB, FB2, TXT, PDF и DOCX — до 30 МБ. Исходный файл сохраняется
        полностью, а текст подготавливается по частям.
      </p>
      <form
        className="mt-4 flex flex-wrap items-center gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (file) upload.mutate(file)
        }}
      >
        <input
          aria-label="Выберите файл EPUB, FB2, TXT, PDF или DOCX"
          aria-describedby="upload-help"
          type="file"
          accept=".txt,.epub,.fb2,.pdf,.docx,text/plain,application/pdf,application/epub+zip,application/x-fictionbook+xml,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={upload.isPending}
          className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-accent"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            setFile(null)
            setError('')
            setProgress(0)
            setSessionId(undefined)
            upload.reset()
            if (!selected) return
            if (!/\.(txt|epub|fb2|pdf|docx)$/i.test(selected.name)) {
              setError('Поддерживаются EPUB, FB2, TXT, PDF и DOCX')
              return
            }
            if (selected.size > 30 * 1024 * 1024) {
              setError('Максимум — 30 МБ')
              return
            }
            setFile(selected)
          }}
        />
        <Button disabled={!file || upload.isPending}>
          {upload.isPending
            ? progress < 100
              ? `Загрузка ${progress}%`
              : 'Проверяем и подготавливаем…'
            : sessionId
              ? 'Продолжить загрузку'
              : 'Загрузить и подготовить'}
        </Button>
      </form>
      {(error || upload.isError) && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error || upload.error?.message}
        </p>
      )}
      {upload.isPending && (
        <div role="status" className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-teal-600 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-accent">
            Передано {progress}%. После сетевого сбоя нажмите «Продолжить
            загрузку».
          </p>
        </div>
      )}
    </section>
  )
}
