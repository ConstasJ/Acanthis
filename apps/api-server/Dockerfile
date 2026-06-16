FROM node:24-slim AS base

RUN corepack enable && \
    corepack prepare pnpm@latest --activate

FROM base AS builder

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile && \
    pnpm --filter=@acanthis/api-server build

FROM base AS pre-final

WORKDIR /app

RUN apt update && apt install -y --no-install-recommends \
    ca-certificates

RUN npm init -y && npm pkg set type=module && \
    npm install @libsql/client koffi isolated-vm

COPY libcurl-impersonate.tar.gz /

RUN mkdir -p /usr/local/lib/libcurl-impersonate && \
    tar -xzf /libcurl-impersonate.tar.gz -C /usr/local/lib/libcurl-impersonate && \
    rm /libcurl-impersonate.tar.gz

ENV LIBCURL_PATH=/usr/local/lib/libcurl-impersonate/libcurl-impersonate.so

FROM pre-final AS production

WORKDIR /app

COPY --from=builder /app/apps/api-server/dist/index.js ./
COPY --from=builder /app/packages/storage/migrations ./migrations

EXPOSE 5301

VOLUME /app/data

CMD ["node", "index.js"]