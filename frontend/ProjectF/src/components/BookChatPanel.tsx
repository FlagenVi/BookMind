import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpenText, BookPlus, Info, Send, Trash2 } from 'lucide-react'
import { bookChatApi, type BookChatMode, type BookChatThread } from '../api/bookChat'
import { Button } from './ui/button'
import { NativeSelect } from './ui/native-select'

const botName = 'Книжник'

function FormattedAnswer({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {text.split(/(\*\*[^\n]+?\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
          : part,
      )}
    </p>
  )
}

export function BookChatPanel({
  bookId,
  onOpenSource,
}: {
  bookId: string
  onOpenSource: (offset: number, label: string) => void
}) {
  const client = useQueryClient()
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
    try { return localStorage.getItem(`book-chat-thread:${bookId}`) } catch { return null }
  })
  const [mode, setMode] = useState<BookChatMode>('grounded')
  const [question, setQuestion] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const threadKey = ['book', bookId, 'chats']
  const threads = useQuery({
    queryKey: threadKey,
    queryFn: ({ signal }) => bookChatApi.threads(bookId, signal),
  })
  const threadId = threads.data
    ? (threads.data.some((thread) => thread.id === selectedThreadId)
        ? selectedThreadId
        : threads.data[0]?.id ?? null)
    : selectedThreadId
  const turnsKey = ['book', bookId, 'chats', threadId, 'turns']
  const turns = useQuery({
    queryKey: turnsKey,
    queryFn: ({ signal }) => bookChatApi.turns(bookId, threadId!, signal),
    enabled: !!threadId && !!threads.data,
    refetchInterval: (query) =>
      query.state.data?.some((turn) => turn.status === 'pending') ? 3000 : false,
  })
  const create = useMutation({
    mutationFn: () => bookChatApi.create(bookId),
    onSuccess: (thread) => {
      setSelectedThreadId(thread.id)
      try { localStorage.setItem(`book-chat-thread:${bookId}`, thread.id) } catch { /* In-memory selection still works. */ }
      setConfirmDelete(false)
      client.setQueryData<BookChatThread[]>(threadKey, (current) => [thread, ...(current ?? [])])
      void client.invalidateQueries({ queryKey: threadKey })
    },
  })
  const remove = useMutation({
    mutationFn: (deletedId: string) => bookChatApi.remove(bookId, deletedId),
    onSuccess: (_, deletedId) => {
      client.setQueryData<BookChatThread[]>(threadKey, (current) => current?.filter((thread) => thread.id !== deletedId))
      setSelectedThreadId(null)
      try { localStorage.removeItem(`book-chat-thread:${bookId}`) } catch { /* The list will pick another thread. */ }
      setConfirmDelete(false)
      void client.invalidateQueries({ queryKey: threadKey })
    },
  })
  const send = useMutation({
    mutationFn: (input: { id: string; question: string; mode: BookChatMode; threadId: string }) =>
      bookChatApi.send(bookId, input.threadId, {
        id: input.id,
        question: input.question,
        mode: input.mode,
      }),
    onMutate: () => { setQuestion(''); nearBottomRef.current = true },
    onSuccess: (turn) => {
      client.setQueryData<typeof turns.data>(turnsKey, (current) => current?.some((item) => item.id === turn.id)
        ? current.map((item) => item.id === turn.id ? turn : item)
        : [...(current ?? []), turn])
      void client.invalidateQueries({ queryKey: turnsKey })
      void client.invalidateQueries({ queryKey: threadKey })
    },
    onError: (_error, input) => {
      setQuestion((current) => current || input.question)
      void client.invalidateQueries({ queryKey: turnsKey })
    },
  })
  const hasPending = turns.data?.some((turn) => turn.status === 'pending') ?? false
  const optimisticTurn = send.isPending && send.variables && !turns.data?.some((turn) => turn.id === send.variables?.id)
    ? send.variables : null
  const lastTurn = turns.data?.at(-1)

  useEffect(() => {
    const list = messagesRef.current
    if (list && nearBottomRef.current) list.scrollTop = list.scrollHeight
  }, [threadId, turns.data?.length, lastTurn?.status, send.isPending])

  return (
    <section className="mt-4 flex min-h-0 flex-1 flex-col" aria-label="Чат по книге">
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <NativeSelect
          containerClassName="min-w-0 flex-1"
          className="min-h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm"
          aria-label="Беседа"
          value={threadId ?? ''}
          disabled={send.isPending || remove.isPending}
          onChange={(event) => {
            setSelectedThreadId(event.target.value)
            nearBottomRef.current = true
            try { localStorage.setItem(`book-chat-thread:${bookId}`, event.target.value) } catch { /* In-memory selection still works. */ }
            setConfirmDelete(false)
            send.reset()
          }}
        >
          {threads.data?.length ? threads.data.map((thread) => (
            <option key={thread.id} value={thread.id}>{thread.title}</option>
          )) : <option value="">Нет бесед</option>}
        </NativeSelect>
        <Button variant="outline" className="shrink-0 px-3" aria-label="Новая беседа" title="Новая беседа" onClick={() => create.mutate()} disabled={create.isPending || send.isPending || remove.isPending}>
          <BookPlus size={18} />
        </Button>
        {threadId && (
          <Button variant="outline" className="shrink-0 px-3 text-danger" aria-label="Удалить беседу" title="Удалить беседу" onClick={() => setConfirmDelete(true)} disabled={hasPending || send.isPending}>
            <Trash2 size={18} />
          </Button>
        )}
      </div>
      {threads.isError && <p role="alert" className="pb-2 text-sm text-danger">{threads.error.message}</p>}
      {create.isError && <p role="alert" className="pb-2 text-sm text-danger">{create.error.message}</p>}
      {confirmDelete && threadId && (
        <div className="mb-3 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm">
          <p>Удалить эту беседу и все её сообщения?</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Отмена</Button>
            <Button onClick={() => remove.mutate(threadId)} disabled={remove.isPending}>Удалить</Button>
          </div>
        </div>
      )}
      {remove.isError && <p role="alert" className="pb-2 text-sm text-danger">{remove.error.message}</p>}
      {threadId ? (
        <>
          <div
            ref={messagesRef}
            onScroll={(event) => {
              const list = event.currentTarget
              nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90
            }}
            className="project-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain border-y border-line py-4 pr-2"
            aria-label="Сообщения беседы"
          >
            {turns.isPending && <p role="status" className="text-center text-sm text-muted">Загружаем историю…</p>}
            {turns.isError && <p role="alert" className="text-sm text-danger">{turns.error.message}</p>}
            {turns.data?.length === 0 && !optimisticTurn && (
              <div className="mx-auto max-w-xs py-8 text-center">
                <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent"><BookOpenText size={22} /></span>
                <p className="mt-3 font-semibold">Спросите Книжника о книге</p>
                <p className="mt-1 text-sm leading-6 text-muted">Спросите о персонаже или событии. Ответы сохранятся в этой книге.</p>
              </div>
            )}
            {turns.data?.map((turn) => (
              <div key={turn.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-3 text-sm leading-6">
                    <p className="whitespace-pre-wrap break-words">{turn.question}</p>
                    <p className="mt-1 text-right text-[11px] text-muted">Вы · {new Date(turn.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface text-accent"><BookOpenText size={17} /></span>
                  <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm leading-6">
                    <p className="mb-1 text-xs font-semibold text-accent">{botName}</p>
                    {turn.status === 'pending' && <p role="status" className="text-muted">Пишет ответ…</p>}
                    {turn.status === 'failed' && <p role="alert" className="text-danger">{turn.errorMessage}</p>}
                    {turn.answer && <FormattedAnswer text={turn.answer} />}
                    <p className="mt-2 text-xs text-muted">
                      {turn.mode === 'grounded'
                        ? `По книге · до позиции ${turn.positionOffset?.toLocaleString('ru-RU') ?? '—'}`
                        : 'По знаниям модели · не проверено по файлу'}
                    </p>
                    {!!turn.references?.length && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                        {turn.references.map((reference, index) => (
                          <Button key={`${turn.id}-${index}`} variant="outline" className="min-h-8 px-2 py-1 text-xs" onClick={() => onOpenSource(reference.startOffset, reference.title)}>
                            [{index + 1}] {reference.title}
                          </Button>
                        ))}
                      </div>
                    )}
                    {(turn.promptTokens > 0 || turn.completionTokens > 0) && (
                      <details className="mt-2 text-xs text-muted">
                        <summary className="cursor-pointer">Расход токенов</summary>
                        <p className="mt-1">{turn.promptTokens.toLocaleString('ru-RU')} вход · {turn.completionTokens.toLocaleString('ru-RU')} ответ</p>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {optimisticTurn && (
              <div className="space-y-3">
                <div className="flex justify-end"><p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-4 py-3 text-sm leading-6">{optimisticTurn.question}</p></div>
                <div className="flex items-start gap-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface text-accent"><BookOpenText size={17} /></span><div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm"><p className="mb-1 text-xs font-semibold text-accent">{botName}</p><p role="status" className="text-muted">Пишет ответ…</p></div></div>
              </div>
            )}
          </div>
          <form onSubmit={(event) => {
            event.preventDefault()
            if (threadId && question.trim() && !send.isPending && !hasPending)
              send.mutate({ id: crypto.randomUUID(), question: question.trim(), mode, threadId })
          }} className="shrink-0 pt-3">
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-xs font-medium text-muted" htmlFor="book-chat-mode">Источник</label>
              <NativeSelect id="book-chat-mode" containerClassName="min-w-0 flex-1" className="min-h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs" value={mode} onChange={(event) => setMode(event.target.value as BookChatMode)} disabled={send.isPending || hasPending}>
                <option value="grounded">По моей книге</option>
                <option value="model_knowledge">О книге без файла</option>
              </NativeSelect>
            </div>
            {mode === 'model_knowledge' && <p className="mt-1 text-xs text-muted">Без файла книги: модель может ошибаться в деталях.</p>}
            <div className="mt-2 flex items-end gap-2 rounded-xl border border-line bg-surface p-2 focus-within:border-accent">
              <label className="sr-only" htmlFor="book-chat-question">Сообщение</label>
              <textarea
                id="book-chat-question"
                className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm outline-none"
                rows={2}
                maxLength={2000}
                placeholder="Спросите о книге…"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                disabled={send.isPending || hasPending}
              />
              <Button type="submit" className="shrink-0 px-3" aria-label="Отправить сообщение" title="Отправить сообщение" disabled={!question.trim() || send.isPending || hasPending}>
                <Send size={17} />
              </Button>
            </div>
            <div className="mt-2 text-[11px] leading-4 text-muted">
              <p>Enter — отправить · Shift+Enter — новая строка · Запрос может быть платным</p>
              <details className="mt-1">
                <summary className="inline-flex cursor-pointer items-center gap-1"><Info size={12} /> Как работает</summary>
                <p className="mt-1">{mode === 'grounded' ? 'Для ответа используются до 6 отрывков до сохранённой позиции. Остальные главы могут не учитываться.' : 'Файл не отправляется. Ответ по знаниям модели не считается проверенным по вашей книге.'} Книжник настроен на вопросы по выбранной книге. Автоматического повтора нет.</p>
              </details>
            </div>
            {send.isError && <p role="alert" className="mt-2 text-sm text-danger">{send.error.message} Проверьте историю беседы: запрос мог завершиться на сервере.</p>}
          </form>
        </>
      ) : !threads.isPending && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted">Бесед по этой книге пока нет.</p>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>Создать беседу</Button>
        </div>
      )}
    </section>
  )
}
