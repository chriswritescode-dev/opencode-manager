FROM node:20 AS base

RUN apt-get update && apt-get install -y \
    git \
    curl \
    lsof \
    ripgrep \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps

COPY shared ./shared
RUN cd shared && npm install

COPY backend/package.json ./backend/package.json
RUN cd backend && npm install

COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci --legacy-peer-deps || npm install --legacy-peer-deps

COPY backend/src ./backend/src
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public
COPY frontend/*.* ./frontend/

FROM base AS builder

RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s $HOME/.bun/bin/bun /usr/local/bin/bun

COPY --from=deps /app ./

RUN cd frontend && npm run build
RUN NODE_ENV=production bun build backend/src/index.ts --outdir=backend/dist --target=bun --packages=external

FROM base AS runner

RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s $HOME/.bun/bin/bun /usr/local/bin/bun

RUN curl -fsSL https://opencode.ai/install | bash && \
    ln -s $HOME/.opencode/bin/opencode /usr/local/bin/opencode

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5001
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/shared/src ./shared/src
COPY --from=builder /app/shared/node_modules ./shared/node_modules
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/frontend/dist ./frontend/dist

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5001/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/dist/index.js"]
