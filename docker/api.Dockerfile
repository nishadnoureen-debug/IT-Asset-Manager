# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @itam/shared \
 && npm run prisma:generate -w @itam/api \
 && npm run build -w @itam/api

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl su-exec
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/prisma ./apps/api/prisma
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod 755 /usr/local/bin/api-entrypoint
WORKDIR /repo/apps/api
ENV STORAGE_LOCAL_DIR=/data/storage
VOLUME ["/data/storage"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
# Starts as root only to hand the storage mount to the app user, then runs everything below as "app".
ENTRYPOINT ["api-entrypoint"]
# Apply pending migrations, sync reference data (idempotent), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/database/seed.js && node dist/main"]
