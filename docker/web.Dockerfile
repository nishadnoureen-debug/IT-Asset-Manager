# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @itam/shared && npm run build -w @itam/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
