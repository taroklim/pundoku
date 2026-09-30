# Pundoku api — многоступенчатая сборка из корня монорепо.
# Контекст сборки — корень репо (см. docker-compose.yml: context: ., dockerfile: apps/api/Dockerfile).

# ---- этап 1: зависимости + сборка ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
# Сначала только манифесты — слой установки кэшируется, пока не меняются зависимости.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @pundoku/api...
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN pnpm --filter @pundoku/api... build
# Плоская prod-копия пакета (dist + migrations + только prod node_modules).
RUN pnpm --filter @pundoku/api --prod deploy --legacy /out

# ---- этап 2: рантайм ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Не root: файлы принадлежат node (uid 1000). Приложение ничего не пишет на диск, миграции только читают
# dist/ и migrations/, так что прав на чтение достаточно.
COPY --from=build --chown=node:node /out ./
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Миграции перед стартом — страховка для `docker run` образа как есть. В прод-стеке (docker-compose.yml) команда
# переопределена: миграции гоняет одноразовый сервис `migrate` до старта api (см. DEPLOY.md, «Миграции»).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
