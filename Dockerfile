FROM node:24.21.0-trixie AS base

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

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

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
COPY frontend/plugins ./frontend/plugins
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/components.json frontend/eslint.config.js ./frontend/

RUN pnpm --filter frontend build

FROM base AS runner

# uv 0.12.8 and later segfault under qemu-user x86_64 emulation, which is how
# an arm64 host builds the amd64 platform; 0.12.7 is the newest verified-good
# release, so re-verify a bump there before moving it.
ARG UV_VERSION=0.12.7
ARG OPENCODE_VERSION=2.0.15
ARG MICROSANDBOX_VERSION=0.7.2
ARG PLAYWRIGHT_VERSION=1.63.0
# Bump TOOLS_CACHEBUST (e.g. via --build-arg) to force a fresh uv/opencode
# install without invalidating the rest of the build cache.
ARG TOOLS_CACHEBUST=0

COPY scripts/lib/opencode-release.sh /usr/local/lib/ocm/opencode-release.sh

RUN echo "Installing uv=${UV_VERSION} opencode=${OPENCODE_VERSION} (cachebust=${TOOLS_CACHEBUST})" && \
    curl -LsSf https://astral.sh/uv/${UV_VERSION}/install.sh | UV_NO_MODIFY_PATH=1 sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    chmod +x /usr/local/bin/uv /usr/local/bin/uvx && \
    test "$(uv --version | cut -d' ' -f2)" = "${UV_VERSION}" && \
    . /usr/local/lib/ocm/opencode-release.sh && \
    echo "Downloading opencode ${OPENCODE_VERSION}..." && \
    download_opencode_to "${OPENCODE_VERSION}" /opt/opencode/bin/opencode && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode && \
    echo "opencode ${OPENCODE_VERSION} installed successfully"

RUN echo "Installing microsandbox=${MICROSANDBOX_VERSION} (cachebust=${TOOLS_CACHEBUST})" && \
    MSB_ARCH=$(uname -m) && \
    if [ "$MSB_ARCH" = "x86_64" ] || [ "$MSB_ARCH" = "amd64" ]; then MSB_TARGET="x86_64"; \
    elif [ "$MSB_ARCH" = "aarch64" ] || [ "$MSB_ARCH" = "arm64" ]; then MSB_TARGET="aarch64"; \
    else echo "ERROR: microsandbox does not support architecture: $MSB_ARCH" >&2; exit 1; fi && \
    MSB_BUNDLE="microsandbox-linux-${MSB_TARGET}.tar.gz" && \
    case "${MICROSANDBOX_VERSION}" in v*) MSB_VERSION="${MICROSANDBOX_VERSION}" ;; *) MSB_VERSION="v${MICROSANDBOX_VERSION}" ;; esac && \
    MSB_BASE_URL="https://github.com/superradcompany/microsandbox/releases/download/${MSB_VERSION}" && \
    curl -fsSL "${MSB_BASE_URL}/${MSB_BUNDLE}" -o "/tmp/${MSB_BUNDLE}" && \
    curl -fsSL "${MSB_BASE_URL}/checksums.sha256" -o /tmp/checksums.sha256 && \
    cd /tmp && \
    grep -F "${MSB_BUNDLE}" checksums.sha256 | sha256sum -c --quiet - && \
    mkdir -p /opt/microsandbox/bin /opt/microsandbox/lib && \
    tar -xzf "/tmp/${MSB_BUNDLE}" -C /tmp && \
    install -m 755 /tmp/msb /opt/microsandbox/bin/msb && \
    ln -sf msb /opt/microsandbox/bin/microsandbox && \
    ln -s /opt/microsandbox/bin/msb /usr/local/bin/msb && \
    MSB_LIB=$(find /tmp -maxdepth 1 -type f -name 'libkrunfw.so.*.*.*' | head -1) && \
    MSB_LIB_NAME=$(basename "$MSB_LIB") && \
    MSB_LIB_ABI=${MSB_LIB_NAME#libkrunfw.so.} && \
    MSB_LIB_ABI=${MSB_LIB_ABI%%.*} && \
    install -m 644 "$MSB_LIB" "/opt/microsandbox/lib/${MSB_LIB_NAME}" && \
    ln -sf "$MSB_LIB_NAME" "/opt/microsandbox/lib/libkrunfw.so.${MSB_LIB_ABI}" && \
    ln -sf "libkrunfw.so.${MSB_LIB_ABI}" /opt/microsandbox/lib/libkrunfw.so && \
    rm -f "/tmp/${MSB_BUNDLE}" /tmp/checksums.sha256 /tmp/msb /tmp/libkrunfw.so.* && \
    chmod -R a+rX /opt/microsandbox && \
    msb --version

RUN echo "Installing Chromium runtime libraries for playwright=${PLAYWRIGHT_VERSION} (cachebust=${TOOLS_CACHEBUST})" && \
    npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium && \
    rm -rf /var/lib/apt/lists/* /root/.npm

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5003
ENV OPENCODE_SERVER_PORT=5551
ENV DATABASE_PATH=/app/data/opencode.db
ENV WORKSPACE_PATH=/workspace
ENV XDG_CACHE_HOME=/home/node/.cache
ENV OPENCODE_BUNDLED_VERSION=${OPENCODE_VERSION}
ENV MSB_PATH=/usr/local/bin/msb
ENV MSB_LIBKRUNFW_PATH=/opt/microsandbox/lib/libkrunfw.so

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=deps --chown=node:node /app/frontend/node_modules ./frontend/node_modules
COPY package.json pnpm-workspace.yaml ./

RUN mkdir -p /app/backend/node_modules/@opencode-manager && \
    ln -sfn /app/shared /app/backend/node_modules/@opencode-manager/shared

COPY scripts/lib/container-user.sh /usr/local/lib/ocm/container-user.sh
COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /workspace /app/data /home/node/.cache /home/node/.opencode /home/node/.microsandbox && \
    chown -R node:node /workspace /app/data /home/node

EXPOSE 5003 5100 5101 5102 5103

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5003/api/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "backend/src/index.ts"]
