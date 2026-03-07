FROM nixos/nix:2.18.1 AS builder

ARG NIX_PACKAGES="git"
ARG DEVCONTAINER_HASH=""

# Install Nix packages
RUN nix-channel --update && \
    nix-env -iA \
      nixpkgs.coreutils \
      nixpkgs.gnused \
      nixpkgs.gnugrep \
      nixpkgs.gawk \
      nixpkgs.findutils \
      ${NIX_PACKAGES}

FROM debian:bookworm-slim

# Copy Nix store
COPY --from=builder /nix /nix
ENV PATH="/nix/var/nix/profiles/default/bin:${PATH}"

# Create vscode user
RUN useradd -m -s /bin/bash vscode && \
    mkdir -p /workspace && \
    chown -R vscode:vscode /workspace

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path && \
    mv /root/.opencode /opt/opencode && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode

# Install Docker client (for DinD communication)
RUN apt-get update && \
    apt-get install -y ca-certificates curl && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

USER vscode
WORKDIR /workspace

LABEL devcontainer.hash="${DEVCONTAINER_HASH}"

CMD ["opencode", "serve", "--port", "5551", "--hostname", "0.0.0.0"]
