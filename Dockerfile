FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# Native SQLite fallback build uses the same libc and Node ABI as runtime.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm build
RUN corepack pnpm --filter @c9view/cli deploy --legacy --prod /out
RUN mkdir -p /out/web-dist && cp -R apps/web/dist/. /out/web-dist/

FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 10001 c9view && useradd --uid 10001 --gid 10001 --create-home c9view \
    && mkdir -p /var/lib/c9view && chown 10001:10001 /var/lib/c9view
WORKDIR /app
COPY --from=build --chown=10001:10001 /out/ ./
ENV HOME=/tmp HOST=0.0.0.0 C9VIEW_AUTH=token C9VIEW_CLAUDE_DIR=/data/claude C9VIEW_DB=/var/lib/c9view/index.sqlite C9VIEW_STATE_DIR=/data/claude/c9view C9VIEW_WEB_DIST=/app/web-dist
USER 10001:10001
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:7777/api/health'); if (!r.ok || !(await r.json()).ok) process.exit(1)"]
ENTRYPOINT ["node", "/app/dist/main.js"]
CMD ["start"]
