import { request } from './client'

export interface PeriodStatistics {
  durationSeconds: number
  charactersRead: number
  approximatePages: number
  averageCharactersPerMinute: number
  booksFinished: number
}

export interface ActivityDay {
  date: string
  durationSeconds: number
  charactersRead: number
}

export interface CurrentReadingBook {
  id: string
  title: string
  format: string
  hasCover: boolean
  progressPercent: number
  remainingSeconds: number | null
}

export interface ReadingGoal {
  dailyMinutes: number
  monthlyBooks: number
}

export interface ReadingStatistics {
  day: PeriodStatistics
  week: PeriodStatistics
  month: PeriodStatistics
  activity: ActivityDay[]
  currentBook: CurrentReadingBook | null
  goal: ReadingGoal
  library: {
    totalBooks: number
    readingBooks: number
    finishedBooks: number
    bookmarks: number
    notes: number
  }
  genres: Array<{
    genre: string
    books: number
  }>
}

export const readingApi = {
  statistics: (timezone: string, signal?: AbortSignal) =>
    request<ReadingStatistics>(
      `/reading/statistics?${new URLSearchParams({ timezone })}`,
      { signal },
    ),
  saveGoal: (goal: ReadingGoal) =>
    request<ReadingGoal>('/reading/goal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goal),
    }),
}
