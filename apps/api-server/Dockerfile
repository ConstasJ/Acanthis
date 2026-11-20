# syntax=docker/dockerfile:1

ARG RUNTIME_IMAGE=ghcr.io/constasj/acanthis-api-server:runtime
ARG NODE_BUILDER_IMAGE=node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

FROM --platform=$BUILDPLATFORM ${NODE_BUILDER_IMAGE} AS builder

RUN corepack enable && \
	corepack prepare pnpm@12.21.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api-server/package.json ./apps/api-server/
COPY apps/cli/package.json ./apps/cli/
COPY apps/web/package.json ./apps/web/
COPY packages/browser-fetch/package.json ./packages/browser-fetch/
COPY packages/core/package.json ./packages/core/
COPY packages/deobfuscator/package.json ./packages/deobfuscator/
COPY packages/epub/package.json ./packages/epub/
COPY packages/linovelib/package.json ./packages/linovelib/
COPY packages/storage/package.json ./packages/storage/
COPY tools/config-tsdown/package.json ./tools/config-tsdown/
COPY tools/config-typescript/package.json ./tools/config-typescript/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
	ONNXRUNTIME_NODE_INSTALL=skip pnpm install \
		--store-dir /pnpm/store \
		--filter=@acanthis-dec/api-server... \
		--frozen-lockfile

COPY tools/config-typescript ./tools/config-typescript
COPY tools/config-tsdown ./tools/config-tsdown
COPY packages/core ./packages/core
COPY packages/deobfuscator ./packages/deobfuscator
COPY packages/browser-fetch ./packages/browser-fetch
COPY packages/storage ./packages/storage
COPY packages/linovelib ./packages/linovelib
COPY apps/api-server ./apps/api-server

RUN pnpm --filter=@acanthis-dec/api-server run build

FROM ${RUNTIME_IMAGE} AS production

WORKDIR /app

COPY packages/storage/migrations ./migrations
COPY --from=builder /app/apps/api-server/dist/index.js ./

EXPOSE 5301

VOLUME /app/data

CMD ["node", "index.js"]
