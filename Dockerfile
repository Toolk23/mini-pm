# Один контейнер: собранный фронтенд + FastAPI → один URL стенда
FROM node:20-alpine AS front
WORKDIR /front
COPY frontend/ ./
RUN if [ -f package.json ]; then npm ci || npm install; npm run build; else mkdir -p dist; fi

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY data/ data/
COPY --from=front /front/dist frontend/dist
ENV PORT=8000
EXPOSE 8000
CMD uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}
