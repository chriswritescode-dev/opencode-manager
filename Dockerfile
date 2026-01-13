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
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
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

ARG UV_VERSION=latest
ARG OPENCODE_VERSION=latest

RUN echo "Installing uv=${UV_VERSION} opencode=${OPENCODE_VERSION}" && \
    curl -LsSf https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx && \
    if [ "${OPENCODE_VERSION}" = "latest" ]; then \
        curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path; \
    else \
        curl -fsSL https://opencode.ai/install | bash -s -- --version ${OPENCODE_VERSION} --no-modify-path; \
    fi && \
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

