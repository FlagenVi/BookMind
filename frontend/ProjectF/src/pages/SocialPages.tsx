import {
  Bell,
  BookHeart,
  CalendarDays,
  MessageCircle,
  Newspaper,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'

type Feature = {
  title: string
  description: string
  Icon: LucideIcon
}

type PlaceholderPageProps = {
  eyebrow: string
  title: string
  description: string
  Icon: LucideIcon
  features: Feature[]
}

function PlaceholderPage({
  eyebrow,
  title,
  description,
  Icon,
  features,
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl leading-7 text-muted">{description}</p>
        </div>
        <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Icon size={30} aria-hidden="true" />
        </span>
      </header>

      <section className="mt-8 rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <Sparkles size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Раздел готовится</h2>
            <p className="mt-0.5 text-sm text-muted">
              Здесь появятся основные возможности раздела.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {features.map(({ title: featureTitle, description: featureDescription, Icon: FeatureIcon }) => (
            <article
              key={featureTitle}
              className="rounded-2xl border border-line bg-page/70 p-5"
            >
              <FeatureIcon size={20} className="text-accent" aria-hidden="true" />
              <h3 className="mt-4 font-semibold">{featureTitle}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {featureDescription}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export function CommunicationPage() {
  return (
    <PlaceholderPage
      eyebrow="Люди и разговоры"
      title="Общение"
      description="Друзья, личные переписки и групповые беседы о книгах в одном месте."
      Icon={MessageCircle}
      features={[
        { title: 'Друзья', description: 'Поиск читателей, заявки и список друзей.', Icon: UserPlus },
        { title: 'Личные чаты', description: 'Разговоры один на один с историей сообщений.', Icon: MessageCircle },
        { title: 'Обмен книгами', description: 'Отправка книги или рекомендации прямо в беседу.', Icon: BookHeart },
      ]}
    />
  )
}

export function CommunitiesPage() {
  return (
    <PlaceholderPage
      eyebrow="Книжные пространства"
      title="Сообщества"
      description="Клубы по интересам, тематические обсуждения и новости для читателей."
      Icon={Users}
      features={[
        { title: 'Книжные клубы', description: 'Открытые и закрытые сообщества с участниками и правилами.', Icon: Users },
        { title: 'Обсуждения', description: 'Темы по произведениям, главам, авторам и жанрам.', Icon: MessageCircle },
        { title: 'Новости', description: 'Публикации сообщества и важные обновления клуба.', Icon: Newspaper },
      ]}
    />
  )
}

export function NotificationsPage() {
  return (
    <PlaceholderPage
      eyebrow="Центр событий"
      title="Уведомления"
      description="Заявки в друзья, новые сообщения, ответы и события сообществ."
      Icon={Bell}
      features={[
        { title: 'Сообщения', description: 'Новые личные и групповые сообщения.', Icon: MessageCircle },
        { title: 'Заявки', description: 'Приглашения в друзья и книжные клубы.', Icon: UserPlus },
        { title: 'События', description: 'Ответы в обсуждениях и запланированные встречи.', Icon: CalendarDays },
      ]}
    />
  )
}
