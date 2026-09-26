# syntax=docker/dockerfile:1
# Web app and API in ONE container, for hosts that give you a single service (e.g. Render's free plan).
# The API listens on 127.0.0.1:4000 only; the Next.js server is the public entry point and proxies
# /api/v1 to it. Use STORAGE_DRIVER=database (or s3) when the host has no persistent disk.
FROM node:22-alpine AS build
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
WORKDIR /repo
# Baked into the Next.js build: the proxy target inside this container.
ENV API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_PUBLIC_API_URL=/api/v1 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @itam/shared \
 && npm run prisma:generate -w @itam/api \
 && npm run build -w @itam/api \
 && npm run build -w @itam/web

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm_config_update_notifier=false
RUN addgroup -S app && adduser -S app -G app
WORKDIR /repo
# API: compiled code plus node_modules (Prisma CLI for migrations, generated client).
COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/prisma ./apps/api/prisma
# Letterhead and watermark for the handover / transfer / return forms.
COPY --from=build --chown=app:app /repo/apps/api/assets ./apps/api/assets
# Web: the self-contained Next.js server.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone /web
COPY --from=build --chown=app:app /repo/apps/web/.next/static /web/apps/web/.next/static
# Logos and other static files (the standalone bundle does not include public/).
COPY --from=build --chown=app:app /repo/apps/web/public /web/apps/web/public
COPY --chown=app:app docker/start-app.mjs /repo/start-app.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/v1/health" || exit 1
CMD ["node", "/repo/start-app.mjs"]
