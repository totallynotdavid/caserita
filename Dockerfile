FROM oven/bun:1.4.3-slim AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile --production

FROM node:24-slim

ENV NODE_ENV=production
ENV DB_PATH=/app/data/caserita.sqlite
ENV PORT=8787

WORKDIR /app

RUN groupadd --system --gid 10001 caserita \
  && useradd --system --uid 10001 --gid caserita \
    --home-dir /app --shell /usr/sbin/nologin caserita \
  && mkdir -p /app/data \
  && chown -R caserita:caserita /app

COPY --from=dependencies --chown=caserita:caserita /app/node_modules ./node_modules
COPY --from=dependencies --chown=caserita:caserita /app/server/node_modules ./server/node_modules
COPY --chown=caserita:caserita package.json ./package.json
COPY --chown=caserita:caserita server/package.json ./server/package.json
COPY --chown=caserita:caserita server/src ./server/src

VOLUME ["/app/data"]
USER caserita

CMD ["node", "server/src/server.ts"]
