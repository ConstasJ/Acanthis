FROM --platform=$BUILDPLATFORM node:24-slim AS builder

RUN corepack enable && \
	corepack prepare pnpm@latest --activate

WORKDIR /app

COPY . .

RUN pnpm install --filter=@acanthis-dec/web... --frozen-lockfile

RUN pnpm --filter=@acanthis-dec/web... run build

FROM nginx:alpine

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 apps/web/docker/40-acanthis-config.sh /docker-entrypoint.d/40-acanthis-config.sh

EXPOSE 80
