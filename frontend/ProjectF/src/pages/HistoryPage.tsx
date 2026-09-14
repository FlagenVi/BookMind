import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { documentsApi } from '../api/documents'
import { Button } from '../components/ui/button'
import { PreparationStatus } from '../components/PreparationStatus'
import { ProcessingBadge } from '../components/ProcessingBadge'

export function HistoryPage() {
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: ['documents', 'list', page],
    queryFn: ({ signal }) => documentsApi.list(page, signal),
    refetchInterval: 3000,
  })
  return (
    <>
      <h1 className="text-3xl font-semibold">История</h1>
      <p className="mt-3 text-muted">
        Документы и изложения. Обработка продолжается, даже когда вы уходите с
        этой страницы.
      </p>
      {query.isPending ? (
        <p role="status" className="mt-8">
          Загрузка текстов…
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
      ) : (
        <>
          {query.data.items.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-10 text-center">
              <h2 className="text-xl font-medium">Пока здесь пусто</h2>
              <p className="mt-2 text-muted">
                Сохраните первый текст, чтобы вернуться к нему позже.
              </p>
              <Button asChild className="mt-5">
                <Link to="/">Добавить текст</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {query.data.items.map((document) => (
                <article
                  key={document.id}
                  className="document-card min-w-0 rounded-2xl border border-line bg-surface p-6"
                >
                  <h2 className="break-words text-lg font-semibold">
                    {document.title}
                  </h2>
                  <p className="mt-2 text-xs text-muted">
                    {new Date(document.createdAt).toLocaleDateString('ru-RU')}
                  </p>
                  <p className="mt-3 line-clamp-3 break-words text-sm leading-6 text-muted">
                    {document.preview}
                  </p>
                  <ProcessingBadge state={document.processing} />
                  <Button asChild variant="outline" className="mt-5">
                    <Link
                      to={`/history/${document.id}${document.processing?.level ? `?level=${document.processing.level}` : ''}`}
                    >
                      {document.processing?.status === 'ready'
                        ? 'Читать изложение'
                        : ['queued', 'running', 'waiting'].includes(
                              document.processing?.status ?? '',
                            )
                          ? 'Посмотреть прогресс'
                          : 'Открыть документ'}
                    </Link>
                  </Button>
                </article>
              ))}
            </div>
          )}
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
      navigate('/history', { replace: true })
    },
  })
  return (
    <>
      <Link to="/history" className="text-sm text-accent underline">
        ← К истории
      </Link>
      {query.isPending ? (
        <p role="status" className="mt-8">
          Загрузка текста…
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
        <article className="mt-6 rounded-2xl border border-line bg-surface p-7">
          <h1 className="break-words text-2xl font-semibold">
            {query.data.title}
          </h1>
          <PreparationStatus id={id} />
          <p className="mt-6 whitespace-pre-wrap break-words leading-8 text-secondary">
            {query.data.content.slice(textPage * 10000, (textPage + 1) * 10000)}
          </p>
          {query.data.content.length > 10000 && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
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
                disabled={(textPage + 1) * 10000 >= query.data.content.length}
                onClick={() => setTextPage(textPage + 1)}
              >
                Далее по тексту
              </Button>
            </div>
          )}
          <div className="mt-8 border-t border-line pt-5">
            {confirmDelete ? (
              <>
                <p className="mb-3 text-sm">
                  Удалить документ и связанные изложения? Восстановить их будет
                  нельзя.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? 'Удаление…' : 'Да, удалить'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Отмена
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                Удалить документ
              </Button>
            )}
            {remove.isError && (
              <p role="alert" className="mt-3 text-danger">
                {remove.error.message}
              </p>
            )}
          </div>
        </article>
      )}
    </>
  )
}
