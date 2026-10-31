import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookMarked, Check } from 'lucide-react'
import { authApi } from '../api/auth'
import { Button } from '../components/ui/button'

const schema = z.object({
  email: z.string().trim().email('Введите корректный email').max(254),
  password: z
    .string()
    .min(12, 'Минимум 12 символов')
    .max(128, 'Максимум 128 символов'),
})
export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [rememberMe, setRememberMe] = useState(false)
  const client = useQueryClient()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof schema>) =>
      authApi.authenticate(mode, {
        ...input,
        rememberMe: mode === 'login' && rememberMe,
      }),
    onSuccess: async (profile) => {
      resetField('password')
      await client.cancelQueries()
      client.clear()
      client.setQueryData(['me'], profile)
      navigate('/', { replace: true })
    },
  })
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-md flex-col justify-center">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-primary text-white">
          <BookMarked size={22} aria-hidden="true" />
        </span>
        <div>
          <p className="text-lg font-semibold">BookMind</p>
          <p className="text-sm text-muted">
            Читалка, которая помнит прочитанное
          </p>
        </div>
      </div>
      <section className="rounded-2xl border border-line bg-surface p-8">
        <h1 className="text-3xl font-semibold">
          {mode === 'login' ? 'Вход' : 'Регистрация'}
        </h1>
        <p className="mt-3 text-sm text-muted">
          Читайте книги в браузере и возвращайтесь к ним после перерыва:
          BookMind кратко напомнит, что уже произошло, без спойлеров.
        </p>
        <form
          className="mt-6 space-y-5"
          onSubmit={handleSubmit((input) => mutation.mutate(input))}
        >
          <fieldset disabled={mutation.isPending} className="space-y-5">
            <div>
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                {...register('email')}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                className="mt-2 w-full rounded-xl border border-line px-4 py-3"
              />
              {errors.email && (
                <p
                  id="email-error"
                  role="alert"
                  className="mt-2 text-sm text-danger"
                >
                  {errors.email.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                {...register('password')}
                aria-invalid={!!errors.password}
                aria-describedby="password-help"
                className="mt-2 w-full rounded-xl border border-line px-4 py-3"
              />
              <p id="password-help" className="mt-2 text-xs text-muted">
                От 12 до 128 символов.
              </p>
              {errors.password && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {errors.password.message}
                </p>
              )}
            </div>
            {mode === 'login' && (
              <label
                className={`group flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
                  rememberMe
                    ? 'border-accent/60 bg-accent-soft'
                    : 'border-line bg-page hover:border-line-strong hover:bg-subtle'
                }`}
              >
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="peer sr-only"
                />
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-transparent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                  <Check size={14} strokeWidth={3} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    Запомнить меня
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">
                    Оставаться в аккаунте на этом устройстве 30 дней
                  </span>
                </span>
              </label>
            )}
          </fieldset>
          {mutation.isError && (
            <p role="alert" className="text-sm text-danger">
              {mutation.error.message}
            </p>
          )}
          <Button className="w-full" disabled={mutation.isPending}>
            {mutation.isPending
              ? 'Подождите…'
              : mode === 'login'
                ? 'Войти'
                : 'Зарегистрироваться'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              mutation.reset()
              resetField('password')
            }}
          >
            {mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт'}
          </Button>
        </form>
      </section>
    </div>
  )
}
