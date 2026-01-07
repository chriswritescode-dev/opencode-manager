FROM node:20 AS base

ARG TARGETARCH

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

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install kubectl (supports both amd64 and arm64)
RUN ARCH=$(case ${TARGETARCH} in arm64) echo "arm64" ;; *) echo "amd64" ;; esac) && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/${ARCH}/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl

RUN curl -fsSL https://bun.sh/install | bash && \
    mv /root/.bun /opt/bun && \
    chmod -R 755 /opt/bun && \
    ln -s /opt/bun/bin/bun /usr/local/bin/bun

RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx

RUN python3 -m venv /opt/whisper-venv && \
    /opt/whisper-venv/bin/pip install --no-cache-dir \
    faster-whisper \
    fastapi \
    uvicorn \
    python-multipart

# Chatterbox TTS - CPU-only PyTorch (smaller than CUDA version)
RUN python3 -m venv /opt/chatterbox-venv && \
    /opt/chatterbox-venv/bin/pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    /opt/chatterbox-venv/bin/pip install --no-cache-dir \
    chatterbox-tts \
    fastapi \
    uvicorn \
    python-multipart

ENV WHISPER_VENV=/opt/whisper-venv
ENV CHATTERBOX_VENV=/opt/chatterbox-venv

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
COPY --from=base /opt/whisper-venv /opt/whisper-venv
COPY --from=base /opt/chatterbox-venv /opt/chatterbox-venv
COPY scripts/whisper-server.py ./scripts/whisper-server.py
COPY scripts/chatterbox-server.py ./scripts/chatterbox-server.py
COPY package.json pnpm-workspace.yaml ./

ENV WHISPER_VENV=/opt/whisper-venv
ENV CHATTERBOX_VENV=/opt/chatterbox-venv

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

