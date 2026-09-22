import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookCheck,
  BookOpen,
  Bookmark,
  Camera,
  CalendarDays,
  ChartPie,
  Clock3,
  Highlighter,
  LibraryBig,
  LogOut,
  Monitor,
  Pencil,
  Save,
  ShieldCheck,
  Smartphone,
  Target,
  Tablet,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi, type UserSession } from '../api/auth'
import {
  readingApi,
  type ActivityDay,
  type PeriodStatistics,
  type ReadingGoal,
} from '../api/reading'
import { Button } from '../components/ui/button'
import { ModalDialog } from '../components/ui/modal-dialog'

type Period = 'day' | 'week' | 'month'

const periodLabels: Record<Period, string> = {
  day: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
}

const genreColors = [
  '#0d9488',
  '#0284c7',
  '#d97706',
  '#7c3aed',
  '#e11d48',
  '#64748b',
]

function duration(seconds: number | null | undefined) {
  if (!seconds) return '0 мин'
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return [hours ? `${hours} ч` : '', minutes ? `${minutes} мин` : '']
    .filter(Boolean)
    .join(' ')
}

function activityClass(seconds: number) {
  if (!seconds) return 'bg-subtle'
  if (seconds < 10 * 60) return 'bg-teal-200 dark:bg-teal-950'
  if (seconds < 30 * 60) return 'bg-teal-400 dark:bg-teal-700'
  if (seconds < 60 * 60) return 'bg-teal-600 dark:bg-teal-500'
  return 'bg-teal-800 dark:bg-teal-300'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T12:00:00`))
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function SessionDeviceIcon({ type }: { type: UserSession['deviceType'] }) {
  if (type === 'MOBILE') return <Smartphone size={21} />
  if (type === 'TABLET') return <Tablet size={21} />
  return <Monitor size={21} />
}

export function ProfilePage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('week')
  const [goalDraft, setGoalDraft] = useState<ReadingGoal | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [bioDraft, setBioDraft] = useState('')
  const [sessionTarget, setSessionTarget] = useState<
    UserSession | 'others' | null
  >(null)
  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => authApi.me(signal),
  })
  const statistics = useQuery({
    queryKey: ['reading-statistics'],
    queryFn: ({ signal }) =>
      readingApi.statistics(
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        signal,
      ),
  })
  const sessions = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: ({ signal }) => authApi.sessions(signal),
  })

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await client.cancelQueries()
      client.clear()
      client.setQueryData(['me'], null)
      navigate('/auth', { replace: true })
    },
  })
  const saveGoal = useMutation({
    mutationFn: readingApi.saveGoal,
    onSuccess: (saved) => {
      setGoalDraft(saved)
      client.setQueryData(
        ['reading-statistics'],
        statistics.data ? { ...statistics.data, goal: saved } : undefined,
      )
    },
  })
  const saveProfile = useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (profile) => {
      client.setQueryData(['me'], profile)
      setEditOpen(false)
    },
  })
  const uploadAvatar = useMutation({
    mutationFn: authApi.uploadAvatar,
    onSuccess: (profile) => client.setQueryData(['me'], profile),
  })
  const deleteAvatar = useMutation({
    mutationFn: authApi.deleteAvatar,
    onSuccess: (profile) => client.setQueryData(['me'], profile),
  })
  const revokeSession = useMutation({
    mutationFn: (target: UserSession | 'others') =>
      target === 'others'
        ? authApi.revokeOtherSessions()
        : authApi.revokeSession(target.id),
    onSuccess: async () => {
      setSessionTarget(null)
      await client.invalidateQueries({ queryKey: ['auth-sessions'] })
    },
  })

  const selected: PeriodStatistics | undefined = statistics.data?.[period]
  const activityCalendar = useMemo(() => {
    const days = statistics.data?.activity ?? []
    if (!days.length)
      return { weeks: [] as Array<Array<ActivityDay | null>>, months: [] }
    const first = new Date(`${days[0].date}T12:00:00`)
    const leadingEmptyDays = (first.getDay() + 6) % 7
    const cells: Array<ActivityDay | null> = [
      ...Array.from({ length: leadingEmptyDays }, () => null),
      ...days,
    ]
    while (cells.length % 7) cells.push(null)
    const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
      cells.slice(index * 7, index * 7 + 7),
    )
    const monthFormatter = new Intl.DateTimeFormat('ru-RU', {
      month: 'short',
    })
    const months = weeks.map((week, index) => {
      const monthStart = week.find(
        (day) => day && new Date(`${day.date}T12:00:00`).getDate() === 1,
      )
      const marker = index === 0 ? week.find(Boolean) : monthStart
      return marker
        ? monthFormatter
            .format(new Date(`${marker.date}T12:00:00`))
            .replace('.', '')
        : ''
    })
    return { weeks, months }
  }, [statistics.data?.activity])
  const genreChart = useMemo(() => {
    const source = statistics.data?.genres ?? []
    const visible = source.slice(0, 5)
    const remaining = source.slice(5).reduce((sum, item) => sum + item.books, 0)
    const items = remaining
      ? [...visible, { genre: 'Другие', books: remaining }]
      : visible
    const total = items.reduce((sum, item) => sum + item.books, 0)
    let cursor = 0
    const segments = items.map((item, index) => {
      const start = cursor
      const percent = total ? (item.books * 100) / total : 0
      cursor += percent
      return { ...item, start, end: cursor, color: genreColors[index] }
    })
    return { items: segments, total }
  }, [statistics.data?.genres])
  const genreGradient = genreChart.total
    ? `conic-gradient(${genreChart.items
        .map((item) => `${item.color} ${item.start}% ${item.end}%`)
        .join(', ')})`
    : 'var(--app-subtle)'
  const initials = (me.data?.displayName || me.data?.email || 'П')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('ru-RU')
  const goal = goalDraft ??
    statistics.data?.goal ?? {
      dailyMinutes: 20,
      monthlyBooks: 2,
    }
  const dailyGoalSeconds = goal.dailyMinutes * 60
  const dailyProgress = dailyGoalSeconds
    ? Math.min(
        100,
        Math.round(
          ((statistics.data?.day.durationSeconds ?? 0) * 100) /
            dailyGoalSeconds,
        ),
      )
    : 0
  const monthlyProgress = goal.monthlyBooks
    ? Math.min(
        100,
        Math.round(
          ((statistics.data?.month.booksFinished ?? 0) * 100) /
            goal.monthlyBooks,
        ),
      )
    : 0

  if (me.isPending || statistics.isPending)
    return <p role="status">Загружаем профиль…</p>

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="bg-gradient-to-br from-accent-soft via-surface to-surface p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-5 sm:gap-7">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-teal-700 text-3xl font-semibold text-white shadow-sm sm:h-32 sm:w-32 sm:text-4xl">
                {me.data?.hasAvatar ? (
                  <img
                    src={`/api/auth/profile/avatar?v=${encodeURIComponent(me.data.avatarUpdatedAt)}`}
                    alt="Аватар профиля"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center">
                    {initials}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                  Профиль читателя
                </p>
                <h1 className="mt-2 truncate text-2xl font-semibold sm:text-3xl">
                  {me.data?.displayName || me.data?.email}
                </h1>
                {me.data?.displayName && (
                  <p className="mt-1 truncate text-sm text-muted">
                    {me.data.email}
                  </p>
                )}
                {me.data?.bio && (
                  <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-secondary">
                    {me.data.bio}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted">
                  В ProjectF с{' '}
                  {me.data &&
                    new Date(me.data.createdAt).toLocaleDateString('ru-RU', {
                      month: 'long',
                      year: 'numeric',
                    })}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0 self-start"
              onClick={() => {
                setDisplayNameDraft(me.data?.displayName ?? '')
                setBioDraft(me.data?.bio ?? '')
                saveProfile.reset()
                setEditOpen(true)
              }}
            >
              <Pencil size={17} />
              Редактировать профиль
            </Button>
          </div>
        </div>
      </section>

      {(me.isError || statistics.isError) && (
        <div
          className="rounded-xl bg-danger-soft p-4 text-sm text-danger"
          role="alert"
        >
          {me.error?.message ?? statistics.error?.message}
        </div>
      )}
      {logout.isError && (
        <p role="alert" className="text-sm text-danger">
          {logout.error.message}
        </p>
      )}

      {statistics.data && (
        <>
          <section
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Краткая статистика"
          >
            {[
              {
                label: 'Сегодня читали',
                value: duration(statistics.data.day.durationSeconds),
                detail: `${statistics.data.day.charactersRead.toLocaleString('ru-RU')} символов`,
                Icon: Clock3,
              },
              {
                label: 'За неделю',
                value: `${statistics.data.week.approximatePages.toLocaleString('ru-RU')} стр.`,
                detail: duration(statistics.data.week.durationSeconds),
                Icon: CalendarDays,
              },
              {
                label: 'Сейчас читаю',
                value:
                  statistics.data.library.readingBooks.toLocaleString('ru-RU'),
                detail: `из ${statistics.data.library.totalBooks.toLocaleString('ru-RU')} книг`,
                Icon: BookOpen,
              },
              {
                label: 'Прочитано',
                value:
                  statistics.data.library.finishedBooks.toLocaleString('ru-RU'),
                detail: `заметок: ${statistics.data.library.notes.toLocaleString('ru-RU')}`,
                Icon: BookCheck,
              },
            ].map(({ label, value, detail, Icon }) => (
              <article
                key={label}
                className="rounded-2xl border border-line bg-surface p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted">{label}</p>
                    <p className="mt-2 text-2xl font-semibold">{value}</p>
                    <p className="mt-1 text-xs text-muted">{detail}</p>
                  </div>
                  <span className="rounded-xl bg-accent-soft p-2.5 text-accent">
                    <Icon size={20} />
                  </span>
                </div>
              </article>
            ))}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Динамика чтения
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">Статистика</h2>
                </div>
                <div className="flex rounded-xl border border-line bg-background p-1">
                  {(Object.keys(periodLabels) as Period[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-lg px-3 py-2 text-sm transition ${period === value ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:text-foreground'}`}
                      aria-pressed={period === value}
                      onClick={() => setPeriod(value)}
                    >
                      {periodLabels[value]}
                    </button>
                  ))}
                </div>
              </div>
              {selected && (
                <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
                  {[
                    ['Время чтения', duration(selected.durationSeconds)],
                    [
                      'Прочитано символов',
                      selected.charactersRead.toLocaleString('ru-RU'),
                    ],
                    [
                      'Примерно страниц',
                      selected.approximatePages.toLocaleString('ru-RU'),
                    ],
                    [
                      'Завершено книг',
                      selected.booksFinished.toLocaleString('ru-RU'),
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-surface p-4">
                      <dt className="text-xs uppercase tracking-wide text-muted">
                        {label}
                      </dt>
                      <dd className="mt-1 font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-3 text-xs text-muted">
                Одна примерная страница равна 1800 символам. Паузы и скрытая
                вкладка не учитываются.
              </p>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                Продолжить
              </p>
              <h2 className="mt-1 text-xl font-semibold">Текущая книга</h2>
              {statistics.data.currentBook ? (
                <div className="mt-5 flex gap-4">
                  <div className="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-accent-soft">
                    {statistics.data.currentBook.hasCover ? (
                      <img
                        src={`/api/books/${encodeURIComponent(statistics.data.currentBook.id)}/cover`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-accent">
                        <BookOpen size={25} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-2 font-semibold">
                      {statistics.data.currentBook.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {statistics.data.currentBook.format.toUpperCase()}
                    </p>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-teal-600"
                        style={{
                          width: `${statistics.data.currentBook.progressPercent}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {statistics.data.currentBook.progressPercent}% ·{' '}
                      {statistics.data.currentBook.remainingSeconds === null
                        ? 'прогноз появится после нескольких минут чтения'
                        : `осталось примерно ${duration(statistics.data.currentBook.remainingSeconds)}`}
                    </p>
                    <Button asChild className="mt-4 py-2">
                      <Link
                        to={`/library/${statistics.data.currentBook.id}/read`}
                      >
                        Продолжить
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-xl bg-subtle p-5 text-sm text-muted">
                  Откройте книгу, и она появится здесь.
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-accent-soft p-2.5 text-accent">
                <CalendarDays size={20} />
              </span>
              <div>
                <h2 className="text-xl font-semibold">Календарь активности</h2>
                <p className="text-sm text-muted">Последние 365 дней</p>
              </div>
            </div>
            <div className="activity-calendar-scroll mt-5 overflow-x-auto pb-2">
              <div className="min-w-max">
                <div className="ml-8 flex gap-[3px]" aria-hidden="true">
                  {activityCalendar.months.map((month, index) => (
                    <span
                      key={index}
                      className="h-5 w-3 text-[10px] capitalize text-muted"
                    >
                      {month}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <div
                    className="grid h-[102px] w-6 shrink-0 grid-rows-7 gap-[3px] text-[10px] text-muted"
                    aria-hidden="true"
                  >
                    {['Пн', '', 'Ср', '', 'Пт', '', ''].map((day, index) => (
                      <span key={index} className="flex items-center">
                        {day}
                      </span>
                    ))}
                  </div>
                  <div
                    className="flex gap-[3px]"
                    aria-label="Активность чтения за последние 365 дней"
                  >
                    {activityCalendar.weeks.map((week, weekIndex) => (
                      <div
                        key={weekIndex}
                        className="grid grid-rows-7 gap-[3px]"
                      >
                        {week.map((day, dayIndex) =>
                          day ? (
                            <div
                              key={day.date}
                              className={`h-3 w-3 rounded-[3px] ${activityClass(day.durationSeconds)}`}
                              title={`${dateLabel(day.date)}: ${duration(day.durationSeconds)}`}
                              aria-label={`${dateLabel(day.date)}: ${duration(day.durationSeconds)}`}
                            />
                          ) : (
                            <span
                              key={`empty-${dayIndex}`}
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span>Меньше</span>
              {[0, 300, 1200, 2700, 5000].map((seconds) => (
                <span
                  key={seconds}
                  className={`h-3 w-3 rounded-[3px] ${activityClass(seconds)}`}
                />
              ))}
              <span>Больше</span>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-accent-soft p-2.5 text-accent">
                  <Target size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">Цели чтения</h2>
                  <p className="text-sm text-muted">
                    Без уведомлений и давления
                  </p>
                </div>
              </div>
              <form
                className="mt-6 grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveGoal.mutate(goal)
                }}
              >
                <label className="text-sm font-medium">
                  Минут в день
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={goal.dailyMinutes}
                    onChange={(event) =>
                      setGoalDraft((value) => ({
                        ...(value ?? goal),
                        dailyMinutes: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  Книг в месяц
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
                    value={goal.monthlyBooks}
                    onChange={(event) =>
                      setGoalDraft((value) => ({
                        ...(value ?? goal),
                        monthlyBooks: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <div className="sm:col-span-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Сегодня</span>
                    <span>{dailyProgress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${dailyProgress}%` }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-muted">
                    <span>Книги за месяц</span>
                    <span>{monthlyProgress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${monthlyProgress}%` }}
                    />
                  </div>
                </div>
                {saveGoal.isError && (
                  <p role="alert" className="text-sm text-danger sm:col-span-2">
                    {saveGoal.error.message}
                  </p>
                )}
                <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  {saveGoal.isSuccess && (
                    <p role="status" className="text-sm text-success">
                      Цели сохранены.
                    </p>
                  )}
                  <Button
                    className="w-full sm:ml-auto sm:w-auto"
                    disabled={saveGoal.isPending}
                  >
                    <Save size={16} />
                    {saveGoal.isPending ? 'Сохраняем…' : 'Сохранить цели'}
                  </Button>
                </div>
              </form>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-accent-soft p-2.5 text-accent">
                  <ChartPie size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">Жанры библиотеки</h2>
                  <p className="text-sm text-muted">
                    Распределение книг по указанным жанрам
                  </p>
                </div>
              </div>

              {genreChart.total ? (
                <div className="mt-6 grid items-center gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <div
                    className="mx-auto grid aspect-square w-44 place-items-center rounded-full"
                    style={{ background: genreGradient }}
                    role="img"
                    aria-label={`Распределение по жанрам: ${genreChart.items
                      .map((item) => `${item.genre} — ${item.books}`)
                      .join(', ')}`}
                  >
                    <div className="grid aspect-square w-28 place-items-center rounded-full bg-surface text-center shadow-inner">
                      <div>
                        <p className="text-2xl font-semibold">
                          {genreChart.total}
                        </p>
                        <p className="text-xs text-muted">жанровых меток</p>
                      </div>
                    </div>
                  </div>
                  <ul className="space-y-2.5">
                    {genreChart.items.map((item) => (
                      <li
                        key={item.genre}
                        className="flex min-w-0 items-center gap-2.5 text-sm"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={item.genre}
                        >
                          {item.genre}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {item.books}
                        </span>
                        <span className="w-10 text-right text-xs text-muted tabular-nums">
                          {Math.round((item.books * 100) / genreChart.total)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-6 rounded-xl bg-subtle p-6 text-center text-sm text-muted">
                  Жанры появятся здесь после добавления их к книгам.
                </div>
              )}
              {genreChart.total > statistics.data.library.totalBooks && (
                <p className="mt-4 text-xs text-muted">
                  Книга с несколькими жанрами учитывается в каждом из них.
                </p>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-accent-soft p-2.5 text-accent">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">Устройства и сессии</h2>
                  <p className="text-sm text-muted">
                    Здесь можно отозвать доступ у другого браузера или
                    устройства.
                  </p>
                </div>
              </div>
              {(sessions.data?.filter((session) => !session.current).length ??
                0) > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setSessionTarget('others')}
                >
                  <LogOut size={16} />
                  Завершить остальные
                </Button>
              )}
            </div>

            {sessions.isPending && (
              <p className="mt-5 text-sm text-muted" role="status">
                Загружаем активные сессии…
              </p>
            )}
            {sessions.isError && (
              <p className="mt-5 text-sm text-danger" role="alert">
                {sessions.error.message}
              </p>
            )}
            {sessions.data && (
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {sessions.data.map((session) => (
                  <article
                    key={session.id}
                    className="flex items-start gap-3 rounded-xl border border-line bg-background p-4"
                  >
                    <span className="rounded-xl bg-subtle p-2.5 text-secondary">
                      <SessionDeviceIcon type={session.deviceType} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{session.browser}</h3>
                        {session.current && (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                            Текущая
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {session.operatingSystem}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        Активность: {dateTime(session.lastActiveAt)}
                        <br />
                        Вход: {dateTime(session.createdAt)}
                      </p>
                    </div>
                    {!session.current && (
                      <button
                        type="button"
                        className="rounded-lg p-2 text-muted transition hover:bg-danger-soft hover:text-danger"
                        aria-label={`Завершить сессию ${session.browser} на ${session.operatingSystem}`}
                        title="Завершить сессию"
                        onClick={() => setSessionTarget(session)}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Текущая сессия</p>
                <p className="mt-0.5 text-xs text-muted">
                  Выход завершит сеанс только на этом устройстве.
                </p>
              </div>
              <Button
                variant="outline"
                className="border-danger text-danger hover:bg-danger-soft hover:text-danger"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <LogOut size={17} />
                {logout.isPending ? 'Выходим…' : 'Выйти из аккаунта'}
              </Button>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
            <UserRound size={18} />
            <span>{me.data?.email}</span>
            <LibraryBig size={18} className="ml-auto" />
            <span>{statistics.data.library.totalBooks} книг</span>
            <Bookmark size={18} />
            <span>{statistics.data.library.bookmarks} закладок</span>
            <Highlighter size={18} />
            <span>{statistics.data.library.notes} заметок</span>
          </section>
        </>
      )}

      {editOpen && me.data && (
        <ModalDialog
          labelledBy="profile-edit-title"
          onClose={() => setEditOpen(false)}
          closeDisabled={
            saveProfile.isPending ||
            uploadAvatar.isPending ||
            deleteAvatar.isPending
          }
          className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id="profile-edit-title" className="text-xl font-semibold">
              Редактирование профиля
            </h2>
            <button
              type="button"
              className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-foreground"
              aria-label="Закрыть"
              onClick={() => setEditOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <form
            className="space-y-5 p-5"
            onSubmit={(event) => {
              event.preventDefault()
              saveProfile.mutate({
                displayName: displayNameDraft,
                bio: bioDraft,
              })
            }}
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="h-20 w-20 overflow-hidden rounded-2xl bg-teal-700 text-2xl font-semibold text-white">
                {me.data.hasAvatar ? (
                  <img
                    src={`/api/auth/profile/avatar?v=${encodeURIComponent(me.data.avatarUpdatedAt)}`}
                    alt="Текущий аватар"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center">
                    {initials}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="ui-button ui-button-outline inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-secondary">
                  <Camera size={17} />
                  {uploadAvatar.isPending ? 'Загружаем…' : 'Выбрать фото'}
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploadAvatar.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) uploadAvatar.mutate(file)
                      event.target.value = ''
                    }}
                  />
                </label>
                {me.data.hasAvatar && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deleteAvatar.isPending}
                    onClick={() => deleteAvatar.mutate()}
                  >
                    <Trash2 size={17} />
                    Убрать
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted">PNG, JPEG или WebP, до 2 МБ.</p>
            {(uploadAvatar.isError || deleteAvatar.isError) && (
              <p className="text-sm text-danger" role="alert">
                {uploadAvatar.error?.message ?? deleteAvatar.error?.message}
              </p>
            )}
            <label className="block text-sm font-medium">
              Имя
              <input
                autoFocus
                maxLength={80}
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                placeholder="Как к вам обращаться"
                className="mt-2 h-11 w-full rounded-xl border border-line bg-background px-3"
              />
            </label>
            <label className="block text-sm font-medium">
              О себе
              <textarea
                maxLength={500}
                rows={5}
                value={bioDraft}
                onChange={(event) => setBioDraft(event.target.value)}
                placeholder="Например, любимые книги или цель чтения"
                className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2.5"
              />
              <span className="mt-1 block text-right text-xs text-muted">
                {bioDraft.length}/500
              </span>
            </label>
            {saveProfile.isError && (
              <p className="text-sm text-danger" role="alert">
                {saveProfile.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Отмена
              </Button>
              <Button disabled={saveProfile.isPending}>
                <Save size={17} />
                {saveProfile.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </form>
        </ModalDialog>
      )}

      {sessionTarget && (
        <ModalDialog
          role="alertdialog"
          labelledBy="session-revoke-title"
          describedBy="session-revoke-description"
          onClose={() => setSessionTarget(null)}
          closeDisabled={revokeSession.isPending}
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        >
          <h2 id="session-revoke-title" className="text-xl font-semibold">
            Завершить доступ?
          </h2>
          <p
            id="session-revoke-description"
            className="mt-3 text-sm text-muted"
          >
            {sessionTarget === 'others'
              ? 'Все остальные устройства потеряют доступ к аккаунту. Текущая сессия останется активной.'
              : `${sessionTarget.browser} на ${sessionTarget.operatingSystem} потребуется войти в аккаунт заново.`}
          </p>
          {revokeSession.isError && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {revokeSession.error.message}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={revokeSession.isPending}
              onClick={() => setSessionTarget(null)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={revokeSession.isPending}
              onClick={() => revokeSession.mutate(sessionTarget)}
            >
              <LogOut size={17} />
              {revokeSession.isPending ? 'Завершаем…' : 'Завершить'}
            </Button>
          </div>
        </ModalDialog>
      )}
    </div>
  )
}
