# First Run Setup

On your first visit to OpenCode Manager, you'll complete a guided setup process.

## Interactive Setup

When no admin account exists, you'll be automatically redirected to the setup page.

### Step 1: Create Admin Account

Fill in your account details:

- **Name** - Your display name
- **Email** - Used for login
- **Password** - Minimum 8 characters recommended

Click **Create Account** to continue.

### Step 2: Configure Provider (Optional)

After account creation, configure an AI provider:

1. Navigate to **Settings > Provider Credentials**
2. Select a provider
3. Enter API key or connect via OAuth
4. Save configuration

You can skip this and configure providers later.

## Pre-Configured Admin

For automated or headless deployments, skip interactive setup by setting environment variables:

```bash
# In docker-compose.yml or .env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

When these are set:

- Admin user is created automatically on first startup
- Setup wizard is skipped
- Users must log in with configured credentials

## Adding Passkeys

After initial setup, you can add passkey authentication for passwordless login:

1. Go to **Settings > Security**
2. Click **Add Passkey**
3. Follow your browser/device prompts
4. Name your passkey (e.g., "MacBook Touch ID")

Passkeys provide:

- Passwordless login
- Phishing-resistant authentication
- Biometric support (Touch ID, Face ID, Windows Hello)

## Password Reset

If you forget your password:

1. Set environment variables:
```bash
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=new-password
ADMIN_PASSWORD_RESET=true
```

2. Restart the application

3. Log in with new password

4. **Important:** Remove `ADMIN_PASSWORD_RESET=true` after successful reset

## Security Recommendations

### Production Deployments

- Set a strong `AUTH_SECRET` for session encryption
- Use HTTPS with valid SSL certificate
- Use strong, unique passwords
- Enable passkey authentication
- Regularly rotate API keys

### Generate AUTH_SECRET

```bash
openssl rand -base64 32
```

Add to your environment:

```bash
AUTH_SECRET=your-generated-secret-here
```

## Next Steps

- [Configure OAuth Providers](../configuration/oauth.md) - Enable social login
- [Environment Variables](../configuration/environment.md) - All configuration options
- [Features Overview](../features/overview.md) - Explore capabilities
