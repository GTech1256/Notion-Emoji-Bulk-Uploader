# Notion Workspace Emoji — Bulk Uploader (Unofficial)

Массовая загрузка кастом-эмодзи в **Notion Workspace Emoji Library** через приватные эндпоинты Notion.

> ⚠️ Неофициальный способ (private API). Используйте на свой риск. Может перестать работать при обновлениях Notion.  
> Лимит Notion: **до 500 custom emoji на воркспейс**.

## Возможности
- Массовая загрузка PNG/SVG/WEBP/JPG
- Работа и с POST-form, и с PUT presigned URL (включая `x-amz-tagging`)
- Батч-транзакции + троттлинг
- берёт только иконки Devicon https://devicon.dev/ вида *-original*.ext и *-plain*.ext (можно включать/выключать -wordmark),
- автоматически проверяет текущий лимит 500 кастом-эмодзи в воркспейсе и не зальёт больше, чем свободных слотов,
- если выбрано файлов больше, чем осталось слотов — аккуратно урежет список и явно напишет, сколько возьмёт.

## Как пользоваться (быстрый старт)
1. Откройте `https://www.notion.so/settings/emoji` в нужном воркспейсе.
2. Откройте **DevTools → Console**.
3. Скопируйте содержимое `src/uploader.js`, вставьте в консоль, нажмите **Enter**.
4. Выберите пачку файлов (png/svg/webp/jpg).
5. Дождитесь логов `✅`.
6. Обновите `/emoji`.

## Как получить идентификаторы (USER_ID и SPACE_ID)
Скрипт умеет **автоопределять** их через `loadUserContent`. Если хотите задать вручную:

### Ручной способ: из Network
- На странице `/settings/emoji` откройте **DevTools → Network**
- Любой запрос к `https://www.notion.so/api/v3/...` → вкладка **Headers**
- В заголовках будут:
  - `x-notion-active-user-header` → **USER_ID**
  - `x-notion-space-id` → **SPACE_ID**
