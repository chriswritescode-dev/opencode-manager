# OAuth Providers

Configure social login with OAuth providers.

## Supported Providers

| Provider | Purpose |
|----------|---------|
| GitHub | Social login |
| Google | Social login |
| Discord | Social login |

## GitHub OAuth

### Create OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **OAuth Apps** > **New OAuth App**
3. Fill in:
   - **Application name**: `OpenCode Manager`
   - **Homepage URL**: `http://localhost:5003`
   - **Authorization callback URL**: `http://localhost:5003/api/auth/callback/github`
4. Click **Register application**
5. Copy **Client ID**
6. Generate and copy **Client Secret**

### Configure

```bash
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

### Callback URL

Adjust the callback URL for your environment:

| Environment | Callback URL |
|-------------|--------------|
| Local | `http://localhost:5003/api/auth/callback/github` |
| Production | `https://yourdomain.com/api/auth/callback/github` |

## Google OAuth

### Create OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Go to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Select **Web application**
6. Configure:
   - **Name**: `OpenCode Manager`
   - **Authorized redirect URIs**: `http://localhost:5003/api/auth/callback/google`
7. Click **Create**
8. Copy **Client ID** and **Client Secret**

### Configure

```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Consent Screen

You may need to configure the OAuth consent screen:

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** (or Internal for Workspace)
3. Fill in required fields
4. Add scopes: `email`, `profile`
5. Save

## Discord OAuth

### Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it `OpenCode Manager`
4. Go to **OAuth2** section
5. Add redirect: `http://localhost:5003/api/auth/callback/discord`
6. Copy **Client ID** and **Client Secret**

### Configure

```bash
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
```

## Using OAuth Login

Once configured:

1. Go to the login page
2. Click the provider button (GitHub, Google, Discord)
3. Authorize in the popup
4. You're logged in

### First OAuth Login

On first OAuth login:

- Account is created automatically
- Email from provider is used
- No password is set (OAuth-only)

### Linking Accounts

If you have an existing password account:

1. Log in with password
2. Go to **Settings > Connected Accounts**
3. Click **Connect** for a provider
4. Authorize the connection

## Production Considerations

### Update Callback URLs

Before deploying, update OAuth apps with production URLs:

```
https://yourdomain.com/api/auth/callback/github
https://yourdomain.com/api/auth/callback/google
https://yourdomain.com/api/auth/callback/discord
```

### Verify Domains

Some providers require domain verification:

- Google requires verification for production
- Discord may require verification for many users

### Secrets Management

- Never commit OAuth secrets to version control
- Use environment variables or secrets management
- Rotate secrets periodically

## Troubleshooting

### Redirect URI Mismatch

Error: "redirect_uri_mismatch" or similar

**Solution:**
1. Check callback URL in provider settings
2. Ensure exact match (including trailing slash)
3. Verify protocol (http vs https)
4. Check port number

### Invalid Client

Error: "invalid_client" or "unauthorized_client"

**Solution:**
1. Verify Client ID is correct
2. Check Client Secret hasn't changed
3. Ensure OAuth app is not suspended

### Access Denied

Error: "access_denied" or user cancels

**Solution:**
1. User may have denied permission
2. Check required scopes are configured
3. Verify consent screen is configured properly
