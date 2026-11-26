# Фронтенд «мини ПМ»

Vite + React 18 + TypeScript + ECharts + react-router. Сборка (`frontend/dist`) отдаётся тем же FastAPI — у стенда один URL.

## Запуск
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api проксируется на http://127.0.0.1:8000
npm run build      # → frontend/dist; FastAPI подхватит при следующем старте
```
Другой адрес бэкенда для dev: `API_TARGET=http://host:port npm run dev`.

## Моки
Работа без бэкенда: переключатель «Данные: моки / API» в шапке, `?mock=1` в адресе или `VITE_USE_MOCKS=1` при сборке.
Моки — реальные ответы бэкенда (`src/mocks/data/*.json`), состояние задач и гипотез живёт в памяти вкладки.
Обновить моки с локального бэкенда (меняет его `data/state` — только локально):
```bash
python frontend/scripts/dump_mocks.py http://127.0.0.1:8000
```

## Структура
- `src/api` — типы по `docs/api.md` и клиент (`api.*`, `pollInvestigation`)
- `src/mocks` — мок-сервер по контракту
- `src/components` — каркас, UI-примитивы (`NoData` — «нет данных» ≠ ноль, `AiBadge` — тег «сгенерирована ИИ-помощником»)
- `src/pages` — экраны: дашборд, сквозная история, расследования, письма, бэклог, чат, база знаний, настройки
