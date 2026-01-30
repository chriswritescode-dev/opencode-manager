# Telegram Integration for OpenCode Manager

## Overview

This document describes how to integrate Telegram messaging with OpenCode Manager, allowing users to interact with OpenCode via Telegram bot.

## Quick Start (Tested & Working)

```bash
# 1. Install owpenbot
npm install -g owpenwork

# 2. Get a bot token from @BotFather on Telegram

# 3. Start the bridge (replace values)
OPENCODE_URL=http://localhost:5551 \
OPENCODE_DIRECTORY=/path/to/your/workspace \
TELEGRAM_BOT_TOKEN=your-bot-token \
TELEGRAM_ENABLED=true \
WHATSAPP_ENABLED=false \
owpenwork start

# 4. Message your bot on Telegram!
```

**Requirements:**
- opencode-manager running (`opencode-manager status`)
- OpenCode server on port 5551 (started automatically by opencode-manager)

## Architecture Options

### Option A: Use owpenbot (Recommended)

[owpenbot](https://github.com/different-ai/openwork/tree/dev/packages/owpenbot) is an MIT-licensed standalone bridge that connects Telegram (and WhatsApp) to any OpenCode server via HTTP API.

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Telegram   │────▶│  owpenbot   │────▶│   OpenCode   │
│   User      │◀────│  (bridge)   │◀────│   Server     │
└─────────────┘     └─────────────┘     │  (port 5551) │
                                        └──────────────┘

Note: owpenbot connects directly to OpenCode server (port 5551),
not through the opencode-manager backend (port 5001).
```

**Pros:**
- Zero code changes to opencode-manager
- Already tested and maintained by different-ai
- Gets WhatsApp support for free
- Runs as separate process (decoupled)
- MIT licensed

**Cons:**
- Separate process to manage
- Requires npm global install
- Configuration in separate file

### Option B: Native Integration

Add Telegram bot directly to opencode-manager backend using the `grammy` library.

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  Telegram   │────▶│         opencode-manager             │
│   User      │◀────│  ┌──────────┐    ┌──────────────┐   │
└─────────────┘     │  │ Telegram │───▶│   OpenCode   │   │
                    │  │ Service  │◀───│   Service    │   │
                    │  └──────────┘    └──────────────┘   │
                    └──────────────────────────────────────┘
```

**Pros:**
- Single process to manage
- Integrated configuration via Settings UI
- Consistent logging and monitoring

**Cons:**
- Additional code to maintain
- Need to implement session management
- Need to implement allowlist/pairing

## Implementation: Option A (owpenbot)

### Prerequisites

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather):
   - Send `/newbot` to @BotFather
   - Follow prompts to name your bot
   - Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. opencode-manager running with API accessible

### Installation

```bash
# Install owpenbot globally
npm install -g owpenwork

# Or run without installing
npx owpenwork
```

### Configuration

Create `~/.owpenbot/owpenbot.json`:

```json
{
  "version": 1,
  "opencode": {
    "url": "http://localhost:5551",
    "directory": "/path/to/your/workspace"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_TELEGRAM_BOT_TOKEN"
    },
    "whatsapp": {
      "enabled": false
    }
  }
}
```

**Important:** Use port 5551 (OpenCode server), not 5001 (opencode-manager backend).

Or use environment variables (recommended):

```bash
export OPENCODE_URL=http://localhost:5551
export OPENCODE_DIRECTORY=/path/to/workspace
export TELEGRAM_BOT_TOKEN=your-bot-token
export TELEGRAM_ENABLED=true
export WHATSAPP_ENABLED=false
```

### Running

```bash
# Check status
owpenwork status

# Start the bridge
owpenwork start

# Or with env vars (recommended)
OPENCODE_URL=http://localhost:5551 \
OPENCODE_DIRECTORY=/path/to/workspace \
TELEGRAM_BOT_TOKEN=your-token \
TELEGRAM_ENABLED=true \
WHATSAPP_ENABLED=false \
owpenwork start
```

### Using with Cloudflare Tunnel

**Note:** owpenbot cannot use a Cloudflare tunnel to opencode-manager because it needs
direct access to the OpenCode server API, which our backend proxies differently.

For remote access, you have two options:

1. **Run owpenbot on the same machine as opencode-manager** (recommended)
2. **Expose OpenCode server port 5551 directly** (requires additional tunnel config)

### Running as a Service (macOS)

Create `~/Library/LaunchAgents/com.owpenbot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.owpenbot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/owpenwork</string>
        <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OPENCODE_URL</key>
        <string>http://localhost:5551</string>
        <key>OPENCODE_DIRECTORY</key>
        <string>/Users/you/workspace</string>
        <key>TELEGRAM_BOT_TOKEN</key>
        <string>your-token</string>
        <key>TELEGRAM_ENABLED</key>
        <string>true</string>
        <key>WHATSAPP_ENABLED</key>
        <string>false</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/owpenbot.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/owpenbot.err</string>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.owpenbot.plist
```

### Running as a Service (Linux systemd)

Create `~/.config/systemd/user/owpenbot.service`:

```ini
[Unit]
Description=Owpenbot Telegram Bridge
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/owpenwork start
Environment=OPENCODE_URL=http://localhost:5551
Environment=OPENCODE_DIRECTORY=/home/you/workspace
Environment=TELEGRAM_BOT_TOKEN=your-token
Environment=TELEGRAM_ENABLED=true
Environment=WHATSAPP_ENABLED=false
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable owpenbot
systemctl --user start owpenbot
```

## Implementation: Option B (Native Integration)

If native integration is preferred, here's the design:

### Dependencies

```bash
cd backend
bun add grammy
```

### Database Schema

Add to `backend/src/db/schema.ts`:

```typescript
export const telegramSessions = sqliteTable('telegram_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull().unique(),
  sessionId: text('session_id').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const telegramAllowlist = sqliteTable('telegram_allowlist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull().unique(),
  addedAt: text('added_at').default(sql`CURRENT_TIMESTAMP`),
});
```

### Service Implementation

Create `backend/src/services/telegram.ts`:

```typescript
import { Bot } from "grammy";
import { db } from "../db";
import { telegramSessions, telegramAllowlist } from "../db/schema";
import { eq } from "drizzle-orm";
import { opencodeService } from "./opencode";

let bot: Bot | null = null;

export async function startTelegramBot(token: string, allowlist: string[]) {
  if (bot) {
    await bot.stop();
  }

  bot = new Bot(token);

  // Seed allowlist
  for (const chatId of allowlist) {
    await db.insert(telegramAllowlist)
      .values({ chatId })
      .onConflictDoNothing();
  }

  bot.on("message", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) return;

    const chatId = String(ctx.message.chat.id);

    // Check allowlist (if not empty)
    const allowlistEntries = await db.select().from(telegramAllowlist);
    if (allowlistEntries.length > 0) {
      const allowed = allowlistEntries.some(e => e.chatId === chatId);
      if (!allowed) {
        await ctx.reply("Access denied. Contact the administrator.");
        return;
      }
    }

    // Get or create session
    let session = await db.select()
      .from(telegramSessions)
      .where(eq(telegramSessions.chatId, chatId))
      .get();

    if (!session) {
      const newSession = await opencodeService.createSession({
        title: `Telegram ${chatId}`,
      });
      await db.insert(telegramSessions).values({
        chatId,
        sessionId: newSession.id,
      });
      session = { chatId, sessionId: newSession.id };
      await ctx.reply("Session started.");
    }

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      // Send message to OpenCode
      const response = await opencodeService.sendMessage(
        session.sessionId,
        text
      );

      // Extract text from response
      const reply = response.parts
        ?.filter((p: any) => p.type === "text" && !p.ignored)
        .map((p: any) => p.text)
        .join("\n")
        .trim();

      if (reply) {
        // Telegram has 4096 char limit, chunk if needed
        const chunks = chunkText(reply, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      } else {
        await ctx.reply("No response generated.");
      }
    } catch (error) {
      console.error("Telegram message error:", error);
      await ctx.reply("Error processing message. Try again.");
    }
  });

  await bot.start();
  console.log("Telegram bot started");
}

export async function stopTelegramBot() {
  if (bot) {
    await bot.stop();
    bot = null;
  }
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  return chunks;
}
```

### API Routes

Add to `backend/src/routes/settings.ts`:

```typescript
// GET /api/settings/telegram
app.get("/telegram", async (c) => {
  const settings = await getSettings();
  return c.json({
    enabled: settings.telegramEnabled ?? false,
    hasToken: Boolean(settings.telegramToken),
    allowlist: settings.telegramAllowlist ?? [],
  });
});

// POST /api/settings/telegram
app.post("/telegram", async (c) => {
  const body = await c.req.json();
  await updateSettings({
    telegramEnabled: body.enabled,
    telegramToken: body.token,
    telegramAllowlist: body.allowlist,
  });
  
  if (body.enabled && body.token) {
    await startTelegramBot(body.token, body.allowlist ?? []);
  } else {
    await stopTelegramBot();
  }
  
  return c.json({ success: true });
});
```

### Frontend UI

Add Telegram settings to `frontend/src/pages/SettingsPage.tsx`:

```tsx
// In the Voice settings section, add:
<Card>
  <CardHeader>
    <CardTitle>Telegram Bot</CardTitle>
    <CardDescription>
      Interact with OpenCode via Telegram
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="flex items-center justify-between">
      <Label>Enable Telegram Bot</Label>
      <Switch
        checked={telegramEnabled}
        onCheckedChange={setTelegramEnabled}
      />
    </div>
    {telegramEnabled && (
      <>
        <div className="space-y-2">
          <Label>Bot Token</Label>
          <Input
            type="password"
            placeholder="123456789:ABCdef..."
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Get from @BotFather on Telegram
          </p>
        </div>
        <div className="space-y-2">
          <Label>Allowed Chat IDs (optional)</Label>
          <Input
            placeholder="123456789, 987654321"
            value={telegramAllowlist}
            onChange={(e) => setTelegramAllowlist(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Leave empty to allow all users
          </p>
        </div>
      </>
    )}
  </CardContent>
</Card>
```

## Security Considerations

1. **Bot Token Security**: Store token securely, never commit to git
2. **Allowlist**: Use allowlist to restrict who can use the bot
3. **Rate Limiting**: Consider adding rate limits per chat ID
4. **Audit Logging**: Log all Telegram interactions
5. **Permission Mode**: owpenbot supports `allow` or `deny` for tool permissions

## Testing

### Manual Test

1. Start opencode-manager: `opencode-manager status`
2. Start owpenbot: `owpenwork start`
3. Message your bot on Telegram
4. Verify response appears

### Automated Test

```bash
# Test with owpenbot's built-in test
OPENCODE_URL=http://localhost:5001 \
TELEGRAM_BOT_TOKEN=your-token \
owpenwork doctor
```

## Troubleshooting

### Bot not responding

1. Check owpenbot logs: `tail -f ~/.owpenbot/owpenbot.log`
2. Verify token is correct: `owpenwork status`
3. Check opencode-manager health: `curl http://localhost:5001/api/health`

### Permission denied

1. Check allowlist configuration
2. Verify chat ID format (should be numeric)

### Session errors

1. Check OpenCode server is running: `curl http://localhost:5001/api/opencode/doc`
2. Verify directory path exists and is a git repo

## References

- [owpenbot source](https://github.com/different-ai/openwork/tree/dev/packages/owpenbot)
- [grammy documentation](https://grammy.dev/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather](https://t.me/BotFather)
