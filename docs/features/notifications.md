# Push Notifications

Send background notifications when the OpenCode Manager PWA is closed, keeping you informed of agent activity without keeping the app open.

## Overview

Push notifications allow you to receive alerts on your mobile device or desktop when:

- The **agent needs permission** to continue (file operations, tool use, etc.)
- The **agent has a question** for you (clarifications, confirmations)
- A **session encounters an error** during execution
- A **session completes successfully**

Notifications are only sent when you don't have the app open (no SSE connections), preventing duplicate alerts while you're actively monitoring a session.

## Supported Events

| Event | Description | Default |
|-------|-------------|---------|
| `permissionAsked` | Agent requests permission for an action | Enabled |
| `questionAsked` | Agent asks a clarifying question | Enabled |
| `sessionError` | Session encounters an error | Enabled |
| `sessionIdle` | Session completes successfully | Disabled |

## Browser Compatibility

Push notifications require HTTPS (except on `localhost`) and browser support:

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome/Edge | ✅ Full | Works well |
| Firefox | ✅ Full | Works well |
| Safari (iOS/macOS) | ✅ Full | Requires `mailto:` VAPID subject |
| Android browser | ✅ Full | Works well |

### iOS/Safari Requirements

Apple's Push Notification Service (APNs) has strict requirements:

1. **HTTPS is required** - `localhost` testing requires Safari Dev Tools
2. **VAPID_SUBJECT must use `mailto:` format** - `https://` subjects are rejected

**Correct:** `VAPID_SUBJECT=mailto:you@yourdomain.com`  
**Incorrect:** `VAPID_SUBJECT=https://yourdomain.com`

## Setup

### 1. Generate VAPID Keys

Generate VAPID public/private key pair:

```bash
npx web-push generate-vapid-keys
```

Output:
```
=======================================
Public Key:
BMx-123456... (your public key here)

Private Key:
abcd1234... (your private key here)

Subject:
mailto:your-email@example.com
=======================================
```

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
VAPID_PUBLIC_KEY=BMx-123456...
VAPID_PRIVATE_KEY=abcd1234...
VAPID_SUBJECT=mailto:you@yourdomain.com
```

### 3. Subscribe Devices

1. Open OpenCode Manager in your browser
2. Go to **Settings** → **Notifications**
3. Click **Enable Push Notifications**
4. Allow browser permission when prompted
5. Your device is now subscribed

## Managing Subscriptions

### View Subscribed Devices

Navigate to **Settings** → **Notifications** to see all registered devices:

- Device name (if provided)
- Subscription date
- Last used timestamp

### Remove a Device

Click **Unsubscribe** next to a device to remove it from receiving notifications.

### Test Notifications

Go to **Settings** → **Notifications** and click **Send Test Notification** to verify your setup is working.

## Notification Preferences

Control which events trigger notifications:

**Notification Settings:**
- **Enable Push Notifications** - Master toggle (default: off)
- **Permission Requested** - Get notified when agent needs permission (default: on)
- **Question Asked** - Get notified when agent has a question (default: on)
- **Session Error** - Get notified on session errors (default: on)
- **Session Complete** - Get notified when session finishes (default: off)

