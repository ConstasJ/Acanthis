FROM node:24-slim AS base

RUN corepack enable && \
    corepack prepare pnpm@latest --activate

FROM base AS builder

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter=@acanthis-dec/api-server run build

FROM base AS pre-final

WORKDIR /app

RUN apt update && apt install -y --no-install-recommends \
    ca-certificates

# onnxruntime-node 自带全平台原生库，这里只保留 Linux，避免镜像体积膨胀
RUN npm init -y && npm pkg set type=module && \
    npm install @libsql/client koffi isolated-vm onnxruntime-node@1.31.1 && \
    (find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 -type d ! -name linux -exec rm -rf {} + || true)

COPY libcurl-impersonate*.tar.gz /libcurl-impersonate.tar.gz

RUN mkdir -p /usr/local/lib/libcurl-impersonate && \
    tar -xzf /libcurl-impersonate.tar.gz -C /usr/local/lib/libcurl-impersonate && \
    rm /libcurl-impersonate.tar.gz

ENV LIBCURL_PATH=/usr/local/lib/libcurl-impersonate/libcurl-impersonate.so

FROM pre-final AS production

WORKDIR /app

COPY --from=builder /app/apps/api-server/dist/index.js ./
COPY --from=builder /app/apps/api-server/dist/captcha_cropped.onnx ./
COPY --from=builder /app/packages/storage/migrations ./migrations

ENV LINOVELIB_CAPTCHA_MODEL_PATH=/app/captcha_cropped.onnx

EXPOSE 5301

VOLUME /app/data

CMD ["node", "index.js"]