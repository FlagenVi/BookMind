# BookMind

Веб-читалка, которая помнит прочитанное. Загрузите книгу, читайте её в браузере, а когда вернётесь после перерыва — BookMind кратко напомнит, что уже произошло. В пересказ и ответы попадает только прочитанная часть, поэтому спойлеров не будет.

## Возможности

- **Библиотека.** EPUB, FB2, TXT, MD, PDF и DOCX до 30 МБ, обложки, коллекции, избранное, статусы «Хочу прочитать / Читаю / Прочитано». Новеллы можно собирать из отдельных файлов глав.
- **Читалка.** Оглавление, прокрутка или страницы, светлая, тёмная и «бумажная» темы, настройки шрифта, закладки, выделения и заметки. Позиция сохраняется на сервере и синхронизируется между устройствами.
- **«Вспомнить прочитанное».** Пересказ книги строго до места, до которого вы дочитали. Когда вы читаете дальше, новый пересказ дополняет прежний, а не пересчитывает всю книгу заново.
- **Книжник.** Чат по книге: отвечает по прочитанной части и показывает, на какие места текста опирается.
- **Статистика и профиль.** Время чтения, календарь активности, жанры, публичный профиль с настройками приватности.
- **Общение.** Друзья, личные сообщения, отправка цитат с пометкой о спойлерах, уведомления.

Пересказ и Книжник работают через [DeepSeek API](https://platform.deepseek.com/). Без ключа API всё остальное работает, а эти функции будут недоступны.

## Что понадобится

- **JDK 21** — для сервера.
- **Node.js 22.12 или новее** — для сборки интерфейса.
- **Docker** — для базы данных PostgreSQL. Можно использовать и свой PostgreSQL 17.
- **Ключ DeepSeek API** — по желанию, для пересказа и чата.
- **Microsoft Word или LibreOffice** — по желанию, для точного постраничного просмотра DOCX. Без них DOCX открывается в упрощённом виде.

## Запуск на своём компьютере

Все команды выполняются из корня репозитория. Примеры даны для PowerShell (Windows) и bash (Linux, macOS).

### 1. База данных

Придумайте имя пользователя и пароль для базы и запустите PostgreSQL в Docker:

```powershell
$env:DB_USERNAME = 'bookmind'
$env:DB_PASSWORD = 'придумайте-пароль'
docker compose -f backend/BookMind/compose.postgres.yml up -d --wait
```

```bash
export DB_USERNAME=bookmind
export DB_PASSWORD='придумайте-пароль'
docker compose -f backend/BookMind/compose.postgres.yml up -d --wait
```

База будет доступна на `localhost:5433`, данные хранятся в Docker volume и не пропадут после перезапуска. Таблицы создаст сервер при первом запуске.

### 2. Ключ DeepSeek (по желанию)

Создайте файл `backend/BookMind/.env` по образцу [`.env.example`](backend/BookMind/.env.example) и впишите ключ:

```
LLM_API_KEY=ваш-ключ
LLM_MODEL=deepseek-flash
```

Сервер сам читает из этого файла только переменные `LLM_*`. Файл `.env` исключён из git — не публикуйте его.

### 3. Сервер

В том же окне терминала, где заданы `DB_USERNAME` и `DB_PASSWORD`:

```powershell
$env:DB_URL = 'jdbc:postgresql://localhost:5433/diplom_platform'
cd backend/BookMind
.\gradlew.bat bootRun --args='--spring.profiles.active=postgres'
```

```bash
export DB_URL=jdbc:postgresql://localhost:5433/diplom_platform
cd backend/BookMind
./gradlew bootRun --args='--spring.profiles.active=postgres'
```

Первый запуск скачает зависимости и создаст таблицы, это займёт пару минут. Сервер слушает порт `8080`.

Профиль `postgres` обязателен: он подключается к базе из `DB_URL` и создаёт таблицы. Без него сервер возьмёт старые настройки для разработки и нужных таблиц не создаст.

### 4. Интерфейс

В новом окне терминала:

```bash
cd frontend/BookMind
npm ci
npm run dev
```

Откройте http://127.0.0.1:5173, зарегистрируйтесь и загрузите первую книгу. Запросы к `/api` интерфейс перенаправляет на `http://localhost:8080`; если сервер на другом порту, поменяйте `target` в [`vite.config.ts`](frontend/BookMind/vite.config.ts).

## Развёртывание на сервере

1. Подготовьте PostgreSQL 17 и пустую базу. Можно тем же `compose.postgres.yml`.
2. Соберите сервер: `./gradlew bootJar` в `backend/BookMind`. Готовый файл — `build/libs/BookMind-0.0.1-SNAPSHOT.jar` (не `-plain.jar`).
3. Запустите его с переменными окружения из таблицы ниже:

   ```bash
   java -jar BookMind-0.0.1-SNAPSHOT.jar --spring.profiles.active=postgres
   ```

   Файл `.env` с ключом DeepSeek читается из текущей папки, либо задайте `LLM_API_KEY` как переменную окружения.
4. Соберите интерфейс: `npm ci && npm run build` в `frontend/BookMind`. Статические файлы появятся в `dist/`.
5. Настройте веб-сервер: отдавать `dist/`, проксировать `/api` на сервер (включая WebSocket для уведомлений) и возвращать `index.html` для остальных адресов. Пример для nginx:

   ```nginx
   server {
       listen 443 ssl;
       server_name bookmind.example.com;
       root /var/www/bookmind/dist;
       client_max_body_size 32m;

       location /api/ {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
           proxy_read_timeout 300s;
       }

       location / {
           try_files $uri /index.html;
       }
   }
   ```

   `$connection_upgrade` объявляется в блоке `http` через `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`.

6. Работайте только по HTTPS и задайте `SERVER_SERVLET_SESSION_COOKIE_SECURE=true`.

Сервер рассчитан на один экземпляр: защита от подбора пароля и уведомления в реальном времени хранят состояние в памяти процесса.

### Переменные окружения

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `DB_URL` | да | Адрес базы, например `jdbc:postgresql://localhost:5433/diplom_platform` |
| `DB_USERNAME`, `DB_PASSWORD` | да | Пользователь и пароль базы |
| `SPRING_PROFILES_ACTIVE` | да, `postgres` | Можно вместо `--spring.profiles.active=postgres` |
| `LLM_API_KEY` | для пересказа и чата | Ключ DeepSeek API |
| `LLM_MODEL` | нет | `deepseek-flash` (по умолчанию) или `deepseek-v4-pro` |
| `SERVER_SERVLET_SESSION_COOKIE_SECURE` | на сервере с HTTPS | `true`, чтобы cookie сессии передавались только по HTTPS |
| `SOFFICE_PATH`, `WORD_PATH` | нет | Путь к LibreOffice или Word, если они установлены не в стандартное место |

## Проверки

Тесты сервера запускают временный PostgreSQL в Docker и не трогают вашу базу:

```bash
cd backend/BookMind
./gradlew test
```

Интерфейс:

```bash
cd frontend/BookMind
npm test
npm run lint
npm run build
```

## Как устроен проект

- `backend/BookMind` — сервер: Java 21, Spring Boot 4, Spring Security, PostgreSQL, Flyway. Миграции базы лежат в `src/main/resources/db/migration`.
- `frontend/BookMind` — интерфейс: React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, PDF.js.
- `docs` — заметки по социальным функциям и аудиту безопасности.

Как работает пересказ без спойлеров:

1. Читалка сохраняет на сервере, до какого места вы дочитали.
2. Сервер берёт текст только до этого места: следующие главы, остаток текущей главы и примечания в конце книги в запрос не попадают. Клиент не может задать эту границу сам.
3. Если для более ранней позиции уже есть пересказ, в DeepSeek уходит он и только новый фрагмент. Интерфейс показывает, во сколько раз меньше текста было отправлено.
4. Книжник ищет подходящие отрывки по прочитанной части с учётом словоформ и редкости слов и дополнительно получает готовый пересказ прочитанного.

Каждое правило проверяется автоматическими тестами сервера.
