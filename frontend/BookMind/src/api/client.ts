export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method)) {
    const csrf = await request<{ token: string; headerName: string }>(
      '/auth/csrf',
    )
    headers.set(csrf.headerName, csrf.token)
  }
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal ?? AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error(
      'Сервер не отвечает. Проверьте подключение и повторите попытку.',
    )
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('session-expired'))
    let message =
      response.status === 401
        ? 'Необходимо войти в аккаунт'
        : response.status === 403
          ? 'Запрос отклонён. Обновите страницу и попробуйте ещё раз.'
          : 'Не удалось выполнить запрос'
    const body = await response.json().catch(() => null)
    if (body && typeof body.message === 'string') message = body.message
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
