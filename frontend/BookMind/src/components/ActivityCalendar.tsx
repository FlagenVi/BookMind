import { useEffect, useMemo, useRef } from 'react'
import { buildActivityCalendar, type CalendarActivityDay } from './activityCalendarData'

function activityClass(seconds: number) {
  if (!seconds) return 'bg-subtle'
  if (seconds < 10 * 60) return 'activity-level-1'
  if (seconds < 30 * 60) return 'activity-level-2'
  if (seconds < 60 * 60) return 'activity-level-3'
  return 'activity-level-4'
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

function duration(seconds: number) {
  if (seconds < 60) return 'меньше минуты'
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours ? `${hours} ч` : '', rest ? `${rest} мин` : '']
    .filter(Boolean)
    .join(' ')
}

export function ActivityCalendar({
  activity,
  endDate,
}: {
  activity: CalendarActivityDay[]
  endDate: string
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const calendar = useMemo(
    () => buildActivityCalendar(activity, endDate),
    [activity, endDate],
  )

  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth
  }, [endDate])

  return (
    <>
      <p className="mt-4 text-xs text-muted sm:hidden">
        Проведите по календарю в сторону, чтобы увидеть предыдущие месяцы.
      </p>
      <div
        ref={scroll}
        className="activity-calendar-scroll mt-4 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        role="region"
        aria-label="Календарь активности за последние 365 дней, прокрутка по горизонтали"
        tabIndex={0}
      >
        <div className="min-w-max" aria-hidden="true">
          <div className="ml-8 flex gap-[3px]">
            {calendar.months.map((month, index) => (
              <span
                key={index}
                className="h-5 w-3 text-[10px] capitalize text-muted"
              >
                {month}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="grid h-[102px] w-6 shrink-0 grid-rows-7 gap-[3px] text-[10px] text-muted">
              {['Пн', '', 'Ср', '', 'Пт', '', ''].map((day, index) => (
                <span key={index} className="flex items-center">
                  {day}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {calendar.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-rows-7 gap-[3px]">
                  {week.map((day, dayIndex) =>
                    day ? (
                      <div
                        key={day.date}
                        className={`h-3 w-3 rounded-[3px] ${activityClass(day.durationSeconds)}`}
                        title={`${dateLabel(day.date)}: ${day.durationSeconds ? duration(day.durationSeconds) : 'нет чтения'}`}
                      />
                    ) : (
                      <span key={`empty-${dayIndex}`} className="h-3 w-3" />
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
            aria-hidden="true"
          />
        ))}
        <span>Больше</span>
      </div>
      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-accent">
          Данные по дням · {calendar.activeDays.length} дней с чтением
        </summary>
        {calendar.activeDays.length ? (
          <div
            className="project-scrollbar mt-2 max-h-64 overflow-y-auto rounded-xl border border-line px-4"
            role="region"
            aria-label="Дни с чтением"
            tabIndex={0}
          >
            <ol>
              {calendar.activeDays.slice().reverse().map((day) => (
                <li
                  key={day.date}
                  className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0"
                >
                  <time dateTime={day.date}>{dateLabel(day.date)}</time>
                  <span className="shrink-0 tabular-nums text-muted">
                    {duration(day.durationSeconds)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            За этот период чтения не было.
          </p>
        )}
      </details>
    </>
  )
}
