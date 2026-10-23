# One image for web and worker (select with the container command).
FROM node:24-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@10.34.7
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Public origin baked into Open Graph metadata at build time.
ARG APP_BASE_URL=http://localhost:3000
ENV APP_BASE_URL=$APP_BASE_URL
COPY . .
RUN node scripts/fetch-fonts.mjs && pnpm --filter @tsq/web build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@10.34.7 && useradd --create-home --uid 10001 tsq
WORKDIR /app
COPY --from=build --chown=tsq:tsq /app /app
USER tsq
EXPOSE 3000
# web: pnpm start · worker: pnpm worker:start · migrations: pnpm db:migrate
CMD ["pnpm", "start"]
