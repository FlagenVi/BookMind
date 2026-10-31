export interface CalendarActivityDay {
  date: string
  durationSeconds: number
}

export function buildActivityCalendar(
  activity: CalendarActivityDay[],
  endDate: string,
) {
  const end = new Date(`${endDate}T00:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 364)
  const byDate = new Map(activity.map((day) => [day.date, day.durationSeconds]))
  const days = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    return { date: key, durationSeconds: Math.max(0, byDate.get(key) ?? 0) }
  })
  const leading = (start.getUTCDay() + 6) % 7
  const cells: Array<CalendarActivityDay | null> = [
    ...Array.from({ length: leading }, () => null),
    ...days,
  ]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  )
  const monthFormatter = new Intl.DateTimeFormat('ru-RU', {
    month: 'short',
    timeZone: 'UTC',
  })
  const months = weeks.map((week, index) => {
    const firstOfMonth = week.find(
      (day) => day && day.date.endsWith('-01'),
    )
    const marker = index === 0 ? week.find(Boolean) : firstOfMonth
    return marker
      ? monthFormatter.format(new Date(`${marker.date}T00:00:00Z`)).replace('.', '')
      : ''
  })
  const nextMonth = months.findIndex((month, index) => index > 0 && month)
  if (nextMonth > 0 && nextMonth < 3) months[0] = ''
  return {
    weeks,
    months,
    activeDays: days.filter((day) => day.durationSeconds > 0),
  }
}
