# ForgeFit cloud image: one small service serves the PWA and its API on the same origin.
FROM node:22-alpine AS web-build
WORKDIR /build
ARG VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
ARG VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
ENV VITE_IMG_BASE=$VITE_IMG_BASE
ENV VITE_GIF_BASE=$VITE_GIF_BASE
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS api-deps
WORKDIR /app
COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev --include=optional && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache bubblewrap libgcc libstdc++ \
 && addgroup -S coach \
 && adduser -S -G coach -H -s /sbin/nologin coach
COPY --from=api-deps /app/node_modules ./node_modules
COPY api/package.json api/package-lock.json* ./
COPY api/server.js api/storage.js ./
COPY api/coach/ ./coach/
COPY api/db/ ./db/
COPY api/drizzle/ ./drizzle/
COPY --from=web-build /build/dist ./public
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV COACH_CODEX_HOME=/data/codex
ENV STATIC_DIR=/app/public
EXPOSE 3000
VOLUME ["/data"]
CMD ["npm", "start"]
