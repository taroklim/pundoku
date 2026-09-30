# Pundoku web — сборка PWA (Vite) + отдача статикой через nginx, он же reverse proxy на api.
# Контекст сборки — корень монорепо (docker-compose.yml: context: ., dockerfile: apps/web/Dockerfile).

# ---- этап 1: зависимости + сборка (engine -> web) ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
# Сначала только манифесты — слой установки кэшируется, пока не меняются зависимости.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @pundoku/web...
COPY packages/engine packages/engine
COPY apps/web apps/web
# `...` — сначала зависимости (движок), затем сам web. VITE_API_BASE_URL не задаём: запросы идут на
# тот же origin (/api/*), его проксирует nginx ниже.
RUN pnpm --filter @pundoku/web... build

# ---- этап 2: nginx со статикой и конфигом ----
FROM nginx:1.27-alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx/security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80
# 127.0.0.1, не localhost: в alpine localhost может резолвиться в ::1, а nginx слушает только IPv4.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
