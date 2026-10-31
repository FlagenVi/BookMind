import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActivityCalendar } from '../src/components/activityCalendarData.ts'

test('calendar fills sparse activity with the full 365-day range', () => {
  const calendar = buildActivityCalendar(
    [
      { date: '2026-09-20', durationSeconds: 120 },
      { date: '2026-09-22', durationSeconds: 240 },
    ],
    '2026-09-23',
  )
  const days = calendar.weeks.flat().filter((day) => day !== null)

  assert.equal(days.length, 365)
  assert.equal(days.at(-1)?.date, '2026-09-23')
  assert.equal(days.find((day) => day.date === '2026-09-21')?.durationSeconds, 0)
  assert.deepEqual(calendar.activeDays.map((day) => day.date), [
    '2026-09-20',
    '2026-09-22',
  ])
})

test('calendar keeps leap day and Monday-aligned weeks', () => {
  const calendar = buildActivityCalendar(
    [{ date: '2024-02-29', durationSeconds: 60 }],
    '2024-03-01',
  )
  const days = calendar.weeks.flat().filter((day) => day !== null)

  assert.equal(days.length, 365)
  assert.equal(days.find((day) => day.date === '2024-02-29')?.durationSeconds, 60)
  assert.equal(calendar.weeks[0][0]?.date ?? null, null)
  assert.equal(calendar.activeDays.length, 1)
})
