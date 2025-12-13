FROM node:20 AS base

RUN apt-get update && apt-get install -y \
    git \
    curl \
    lsof \
    ripgrep \
    ca-certificates \
    grep \
    gawk \
    sed \
    findutils \
    coreutils \
    procps \
    jq \
    less \
    tree \
    file \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

RUN curl -fsSL https://bun.sh/install | bash && \
    mv /root/.bun /opt/bun && \
    chmod -R 755 /opt/bun && \
    ln -s /opt/bun/bin/bun /usr/local/bin/bun

WORKDIR /app

FROM base AS deps

COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=node:node shared/package.json ./shared/
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=deps /app ./
COPY shared ./shared
COPY backend ./backend
COPY frontend/src ./frontend/src
COPY frontend/public ./frontend/public
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/components.json frontend/eslint.config.js ./frontend/

RUN pnpm --filter frontend build

FROM base AS runner

RUN curl -fsSL https://opencode.ai/install | bash && \
    mv /root/.opencode /opt/opencode && \
    chmod -R 755 /opt/opencode && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5003
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY package.json pnpm-workspace.yaml ./

RUN mkdir -p /app/backend/node_modules/@opencode-manager && \
    ln -s /app/shared /app/backend/node_modules/@opencode-manager/shared

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data && \
    chown -R node:node /workspace /app/data

EXPOSE 5003 5100 5101 5102 5103

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5003/api/health || exit 1

USER node

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/src/index.ts"]

