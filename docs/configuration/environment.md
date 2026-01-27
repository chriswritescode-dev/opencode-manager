# Environment Variables

Complete reference for all configuration options.

## Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_SECRET` | Session encryption secret (required for production) | Auto-generated in dev |
| `ADMIN_EMAIL` | Pre-configured admin email | - |
| `ADMIN_PASSWORD` | Pre-configured admin password | - |
| `ADMIN_PASSWORD_RESET` | Set to `true` to reset admin password | `false` |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated list of trusted origins (frontend + backend) | `http://localhost:5173,http://localhost:5003` |
| `AUTH_SECURE_COOKIES` | Use secure cookies (HTTPS only) | `true` in prod |
| `AUTH_SECURE_COOKIES` | Use secure cookies (HTTPS only) | `true` in prod |

## OAuth Providers

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |

## Passkeys (WebAuthn)

| Variable | Description | Default |
|----------|-------------|---------|
| `PASSKEY_RP_ID` | Relying party ID (your domain) | `localhost` |
| `PASSKEY_RP_NAME` | Display name for passkey prompts | `OpenCode Manager` |
| `PASSKEY_ORIGIN` | Origin URL for WebAuthn (backend port) | `http://localhost:5003` |

!!! tip "IMPORTANT"
    - `PASSKEY_ORIGIN` must use the **backend** port (5003), not the frontend port (5173)
    - The origin must exactly match where the auth API is served

## Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5003` |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `WORKSPACE_PATH` | Path to workspace directory | `/workspace` |

## Example .env File

```bash
# Required for production
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Pre-configured admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# Remote access (optional - include both frontend and backend ports)
AUTH_TRUSTED_ORIGINS=http://localhost:5173,http://localhost:5003,http://192.168.1.244:5003
AUTH_SECURE_COOKIES=false

# OAuth providers (optional)
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Passkeys (optional - use BACKEND port)
PASSKEY_RP_ID=localhost
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=http://localhost:5003
```

## Generating Secrets

### AUTH_SECRET

Generate a secure random secret:

```bash
openssl rand -base64 32
```

Output example:
```
K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=
```

!!! warning "Security"
    - Never commit AUTH_SECRET to version control
    - Use different secrets for development and production
    - Rotate secrets periodically

## Environment Precedence

Variables are loaded in this order (later overrides earlier):

1. System environment variables
2. `.env` file in project root
3. Docker Compose `environment` section
4. Docker Compose `env_file` reference

## Validating Configuration

Check your configuration:

```bash
# View current environment (inside container)
docker exec opencode-manager env | grep -E '^(AUTH|ADMIN|PASSKEY)'

# Check if secrets are set (without revealing values)
docker exec opencode-manager sh -c 'if [ -n "$AUTH_SECRET" ]; then echo "AUTH_SECRET: set"; else echo "AUTH_SECRET: NOT SET"; fi'
```
