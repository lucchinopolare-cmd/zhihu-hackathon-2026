# syntax=docker/dockerfile:1

# The project has no third-party runtime dependencies. The builder still gives
# us a repeatable place for syntax and asset checks before the runtime image is
# assembled.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

RUN set -eux; \
    for file in src/*.mjs; do node --check "$file"; done; \
    test -s public/index.html

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    ZHIHU_CONTENT_MODE=live \
    REQUIRE_ORIGIN=true

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/public ./public

# The official Node image provides this unprivileged user. No request-serving
# process in the image runs as root.
USER node

EXPOSE 3000

# Liveness only: /api/health reports process health and does not claim that a
# model key, model quota, Zhihu upstream, or public network path is ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(async r => { await r.arrayBuffer(); if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "src/server.mjs"]
