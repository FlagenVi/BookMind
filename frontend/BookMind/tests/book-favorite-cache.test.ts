import assert from 'node:assert/strict'
import test from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import {
  bookPageQueries,
  setCachedBookFavorite,
} from '../src/library/bookFavoriteCache.ts'

test('favoriting a book updates list pages without treating filter facets as pages', () => {
  const client = new QueryClient()
  const pageKey = ['books', 0, { favorite: 'all' }]
  const facets = { formats: ['epub'], genres: ['fantasy'] }
  const sidebarCurrent = { id: 'book-1', title: 'Тестовая книга' }
  client.setQueryData(['books', 'facets'], facets)
  client.setQueryData(['books', 'sidebar-current'], sidebarCurrent)
  client.setQueryData(pageKey, {
    items: [{ id: 'book-1', favorite: false }],
    page: 0,
    totalPages: 1,
    totalElements: 1,
  })

  assert.equal(client.getQueriesData(bookPageQueries).length, 1)
  setCachedBookFavorite(client, 'book-1', true)

  assert.equal(
    client.getQueryData<{ items: { favorite: boolean }[] }>(pageKey)?.items[0]
      .favorite,
    true,
  )
  assert.deepEqual(client.getQueryData(['books', 'facets']), facets)
  assert.deepEqual(
    client.getQueryData(['books', 'sidebar-current']),
    sidebarCurrent,
  )
})
