import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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
      authApi.authenticate(mode, input),
    onSuccess: async (profile) => {
      resetField('password')
      await client.cancelQueries()
      client.clear()
      client.setQueryData(['me'], profile)
      navigate('/', { replace: true })
    },
  })
  return (
    <section className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-8">
      <h1 className="text-3xl font-semibold">
        {mode === 'login' ? 'Вход' : 'Регистрация'}
      </h1>
      <p className="mt-3 text-sm text-muted">
        Ваши материалы и изложения в одном месте.
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
  )
}
