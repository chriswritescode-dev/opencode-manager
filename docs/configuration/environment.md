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


## Push Notifications (VAPID)

| Variable | Description | Required |
|----------|-------------|----------|
| `VAPID_PUBLIC_KEY` | VAPID public key for push notifications | Yes |
| `VAPID_PRIVATE_KEY` | VAPID private key for push notifications | Yes |
| `VAPID_SUBJECT` | Contact email for VAPID (MUST use `mailto:` format) | Yes |

### Generating VAPID Keys

Generate VAPID public/private key pair:

```bash
npx web-push generate-vapid-keys
```

Add to `.env`:

```bash
VAPID_PUBLIC_KEY=BMx-1234567890abcdefghijklmnopqrstuv...
VAPID_PRIVATE_KEY=abcd1234567890abcdef...
VAPID_SUBJECT=mailto:you@example.com
```

!!! warning "iOS/Safari Requirement"
    `VAPID_SUBJECT` **MUST** use `mailto:` format for iOS/Safari push notifications to work. Apple's push service rejects `https://` subjects.

    **Correct:** `VAPID_SUBJECT=mailto:you@yourdomain.com`
    **Incorrect:** `VAPID_SUBJECT=https://yourdomain.com`

When configured, users can enable push notifications in Settings → Notifications to receive background alerts for agent events.

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

# Push notifications (optional)
VAPID_PUBLIC_KEY=BMx-1234567890abcdefghijklmnopqrstuv...
VAPID_PRIVATE_KEY=abcd1234567890abcdef...
VAPID_SUBJECT=mailto:you@example.com
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


### VAPID Keys

Generate VAPID public/private key pair for push notifications:

```bash
npx web-push generate-vapid-keys
```

Output example:
```
=======================================
Public Key:
BMx-1234567890abcdefghijklmnopqrstuv...

Private Key:
abcd1234567890abcdef...

Subject:
mailto:you@example.com
===========================================
```

!!! warning "iOS/Safari Requirement"
    `VAPID_SUBJECT` **MUST** use `mailto:` format for iOS/Safari push notifications to work.


## Environment Precedence

Variables are loaded in this order (later overrides earlier):

1. System environment variables
2. `.env` file in project root
3. Docker Compose `environment` section
4. Docker Compose `env_file` reference

```
