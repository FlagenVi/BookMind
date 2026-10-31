import type { QueryClient, QueryFilters } from '@tanstack/react-query'
import type { BookPage } from '../api/books'

export const bookPageQueries: QueryFilters = {
  queryKey: ['books'],
  predicate: (query) => typeof query.queryKey[1] === 'number',
}

export function setCachedBookFavorite(
  client: QueryClient,
  id: string,
  favorite: boolean,
) {
  client.setQueriesData<BookPage>(bookPageQueries, (current) =>
    current
      ? {
          ...current,
          items: current.items.map((book) =>
            book.id === id ? { ...book, favorite } : book,
          ),
        }
      : current,
  )
}
