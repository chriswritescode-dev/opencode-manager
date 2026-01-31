---
name: capture-ui-demo
description: Capture UI screenshots at different screen sizes and create demo GIFs for README. Use for updating documentation, creating feature demos, or showcasing responsive design.
metadata:
  author: opencode-manager
  version: "1.0"
compatibility: Requires Chrome DevTools MCP, ffmpeg, and ImageMagick (convert)
---

Capture UI screenshots at different screen sizes and create demo GIFs.

## Prerequisites

Install required tools:

```bash
brew install imagemagick ffmpeg
```

Ensure the app is running:

```bash
curl -s http://localhost:5001/api/health | jq '.status'
```

## Quick Capture (All Screen Sizes)

Use chrome-devtools MCP to capture screenshots at multiple breakpoints.

### Step 1: Navigate to the App

```javascript
// Using chrome-devtools_navigate_page
await chrome-devtools_navigate_page({ url: "http://localhost:5001" })
```

Or if auth is required, include credentials in URL:

```javascript
await chrome-devtools_navigate_page({ url: "http://admin:PASSWORD@localhost:5001" })
```

### Step 2: Capture at Different Screen Sizes

Standard breakpoints for responsive design:

| Device | Width | Height | Description |
|--------|-------|--------|-------------|
| Mobile | 375 | 812 | iPhone X/12/13 |
| Mobile Large | 428 | 926 | iPhone 14 Pro Max |
| Tablet | 768 | 1024 | iPad |
| Desktop | 1280 | 800 | Laptop |
| Desktop Wide | 1920 | 1080 | Full HD |

For each size, use chrome-devtools to resize and screenshot:

```javascript
// Resize to mobile
await chrome-devtools_resize_page({ width: 375, height: 812 })
await chrome-devtools_take_screenshot({ filePath: "docs/assets/dashboard-mobile.png" })

// Resize to tablet
await chrome-devtools_resize_page({ width: 768, height: 1024 })
await chrome-devtools_take_screenshot({ filePath: "docs/assets/dashboard-tablet.png" })

// Resize to desktop
await chrome-devtools_resize_page({ width: 1280, height: 800 })
await chrome-devtools_take_screenshot({ filePath: "docs/assets/dashboard-desktop.png" })
```

### Step 3: Capture Full Page Screenshots

For long pages, use fullPage option:

```javascript
await chrome-devtools_take_screenshot({ filePath: "docs/assets/full-page.png", fullPage: true })
```

## Creating Demo GIFs

### Option 1: From Multiple Screenshots (Slideshow)

Combine screenshots into an animated GIF:

```bash
# Modern ImageMagick (v7+) uses 'magick' command
magick -delay 150 -loop 0 \
  docs/assets/demo-1-mobile.png \
  docs/assets/demo-2-tablet.png \
  docs/assets/demo-3-desktop.png \
  -resize 600x docs/assets/responsive-demo.gif

# Legacy ImageMagick (v6) uses 'convert' command
convert -delay 150 -loop 0 \
  docs/assets/demo-1-mobile.png \
  docs/assets/demo-2-tablet.png \
  docs/assets/demo-3-desktop.png \
  -resize 600x docs/assets/responsive-demo.gif
```

Parameters:
- `-delay 150` = 1.5 seconds per frame (delay is in 1/100th seconds)
- `-loop 0` = infinite loop
- `-resize 600x` = scale to 600px width, maintain aspect ratio

### Option 2: Screen Recording to GIF

Record a video and convert to GIF:

```bash
# Record screen region (macOS)
# Use Cmd+Shift+5 or screencapture

# Convert video to GIF
ffmpeg -i recording.mov -vf "fps=10,scale=800:-1:flags=lanczos" -c:v gif output.gif

# Or with better quality using palettegen
ffmpeg -i recording.mov -vf "fps=10,scale=800:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i recording.mov -i palette.png -filter_complex "fps=10,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse" output.gif
```

### Option 3: Automated Browser Recording

Use Puppeteer/Playwright to record actions:

```typescript
import puppeteer from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
const recorder = new PuppeteerScreenRecorder(page);

await recorder.start('demo.mp4');
await page.goto('http://localhost:5001');
await page.setViewport({ width: 375, height: 812 });
await page.waitForTimeout(2000);
await page.setViewport({ width: 1280, height: 800 });
await page.waitForTimeout(2000);
await recorder.stop();

// Convert to GIF
// ffmpeg -i demo.mp4 -vf "fps=10,scale=600:-1" demo.gif
```

## Capture Workflow with Chrome DevTools MCP

### Dashboard Demo (Responsive)

```
1. Navigate to http://localhost:5001
2. Wait for page load
3. Take snapshot to verify content loaded
4. For each screen size:
   a. Resize page
   b. Wait 500ms for layout
   c. Take screenshot
5. Combine into GIF
```

### Feature Demo (Interactive)

```
1. Navigate to starting page
2. Set viewport size
3. For each action:
   a. Take screenshot (before)
   b. Perform action (click, type, etc.)
   c. Wait for animation/response
   d. Take screenshot (after)
4. Combine all screenshots into GIF
```

## Example: Dashboard Responsive GIF

Complete workflow using chrome-devtools:

```javascript
// 1. Navigate
chrome-devtools_navigate_page({ url: "http://admin:PASSWORD@localhost:5001" })

// 2. Wait for load
chrome-devtools_wait_for({ text: "Repositories" })

// 3. Mobile screenshot
chrome-devtools_resize_page({ width: 375, height: 812 })
chrome-devtools_take_screenshot({ filePath: "docs/assets/demo-1-mobile.png" })

// 4. Tablet screenshot
chrome-devtools_resize_page({ width: 768, height: 1024 })
chrome-devtools_take_screenshot({ filePath: "docs/assets/demo-2-tablet.png" })

// 5. Desktop screenshot
chrome-devtools_resize_page({ width: 1280, height: 800 })
chrome-devtools_take_screenshot({ filePath: "docs/assets/demo-3-desktop.png" })
```

Then create GIF:

```bash
# Responsive dashboard GIF
magick -delay 150 -loop 0 \
  docs/assets/demo-1-mobile.png \
  docs/assets/demo-2-tablet.png \
  docs/assets/demo-3-desktop.png \
  -resize 600x docs/assets/dashboard-responsive.gif

# Feature tour GIF (all features at desktop size)
magick -delay 150 -loop 0 \
  docs/assets/demo-3-desktop.png \
  docs/assets/feature-search.png \
  docs/assets/settings-general.png \
  docs/assets/settings-shortcuts.png \
  docs/assets/settings-opencode.png \
  docs/assets/settings-providers.png \
  docs/assets/feature-session-chat.png \
  -resize 800x docs/assets/feature-tour.gif
```

## Example: Talk Mode Demo GIF

Capture the Talk Mode workflow:

```javascript
// 1. Navigate to a session
chrome-devtools_navigate_page({ url: "http://admin:PASSWORD@localhost:5001/repos/1/sessions/ses_xxx" })

// 2. Set mobile viewport
chrome-devtools_resize_page({ width: 375, height: 812 })

// 3. Capture initial state
chrome-devtools_take_screenshot({ filePath: "docs/assets/talk-1-initial.png" })

// 4. Click Talk Mode button (find via snapshot)
chrome-devtools_take_snapshot()
chrome-devtools_click({ uid: "talk-mode-button-uid" })

// 5. Capture Talk Mode active
chrome-devtools_take_screenshot({ filePath: "docs/assets/talk-2-listening.png" })

// 6. Wait for response
chrome-devtools_wait_for({ text: "AI response text" })
chrome-devtools_take_screenshot({ filePath: "docs/assets/talk-3-response.png" })
```

## Optimizing GIFs

### Reduce File Size

```bash
# Reduce colors
convert input.gif -colors 128 output.gif

# Reduce frame rate
convert input.gif -coalesce -deconstruct -layers optimize output.gif

# Use gifsicle for better compression
gifsicle -O3 --colors 128 input.gif -o output.gif
```

### Recommended Sizes for README

| Use Case | Max Width | Format |
|----------|-----------|--------|
| Hero image | 800px | GIF or WebP |
| Feature demo | 600px | GIF |
| Mobile screenshot | 300px | PNG |
| Desktop screenshot | 800px | PNG |

## Adding to README

```markdown
## Demo

<p align="center">
  <img src="docs/assets/dashboard-demo.gif" alt="Dashboard Demo" width="600" />
</p>

*Responsive design: Mobile, Tablet, and Desktop views*
```

## Pages/Features to Capture

Complete list of capturable pages and features:

### Core Pages

| Page | URL Path | Description |
|------|----------|-------------|
| Dashboard | `/` | Main dashboard with repos and sessions |
| Session/Chat | `/repos/:id/sessions/:sessionId` | AI chat interface |
| Files | `/repos/:id/files` | File browser |
| Tasks | `/tasks` | Scheduled tasks |

### Dialogs & Overlays

| Feature | Trigger | Description |
|---------|---------|-------------|
| Global Search | `Cmd+K` / click search icon | Search across repos, sessions, files |
| Settings - General | Settings menu → General | Theme, preferences |
| Settings - Shortcuts | Settings menu → Shortcuts | Keyboard shortcut config |
| Settings - OpenCode | Settings menu → OpenCode | OpenCode config editor |
| Settings - Providers | Settings menu → Providers | API keys, OAuth setup |

### Recommended Capture Sets

**1. Responsive Dashboard (3 screenshots → 1 GIF)**
- Mobile 375x812
- Tablet 768x1024
- Desktop 1280x800

**2. Feature Tour (7 screenshots → 1 GIF)**
- Dashboard (desktop)
- Search dialog
- Settings General
- Settings Shortcuts
- Settings OpenCode
- Settings Providers
- Session/Chat view

**3. Talk Mode Demo (separate recording)**
- Use browser E2E test with screen recording
- Convert to GIF with ffmpeg

## Output Locations

All assets should be saved to `docs/assets/`:

```
docs/assets/
  # Responsive demos
  demo-1-mobile.png        # Mobile screenshot
  demo-2-tablet.png        # Tablet screenshot
  demo-3-desktop.png       # Desktop screenshot
  dashboard-responsive.gif # Combined responsive demo
  
  # Feature screenshots
  feature-search.png       # Search dialog
  feature-session-chat.png # Chat/session view
  settings-general.png     # Settings General tab
  settings-shortcuts.png   # Settings Shortcuts tab
  settings-opencode.png    # Settings OpenCode tab
  settings-providers.png   # Settings Providers tab
  feature-tour.gif         # Combined feature tour
  
  # Other demos
  talk-mode-demo.gif       # Talk Mode feature demo
```

## Troubleshooting

### Screenshots are blank

Wait for page to fully load:

```javascript
chrome-devtools_wait_for({ text: "Expected content" })
```

### Auth popup blocks screenshot

Use credentials in URL:

```javascript
chrome-devtools_navigate_page({ url: "http://user:pass@localhost:5001" })
```

### GIF is too large

1. Reduce frame count
2. Reduce dimensions: `-resize 600x`
3. Reduce colors: `-colors 64`
4. Increase compression: `gifsicle -O3`

### Screenshots don't match viewport

Ensure no browser chrome is included:

```javascript
// Take viewport screenshot only (default)
chrome-devtools_take_screenshot({ filePath: "screenshot.png" })

// NOT fullPage which includes scrollable area
chrome-devtools_take_screenshot({ filePath: "screenshot.png", fullPage: false })
```
