# Manager Logs

View the Manager's own log lines and the managed OpenCode server's output directly in the Settings UI, without shell access to the container or host.

## Overview

The **Logs** tab in Settings shows a live stream of what the Manager and the OpenCode server are doing — startup messages, session activity, warnings, and errors. This is the quickest way to answer "why did that just fail?" while the app is running.

Each entry shows a timestamp, severity level, source, and message:

- **Manager** — Lines emitted by the Manager's own logger (the same lines written to the console/container logs)
- **OpenCode server** — stdout and stderr captured from the supervised OpenCode server process

## Filters

| Control | Behavior |
|---------|----------|
| **Level** | Minimum severity filter: *All levels*, *Info and above*, *Warnings and above*, or *Errors* |
| **Source** | Show only **Manager** lines, only **OpenCode server** lines, or both |
| **Search messages** | Case-insensitive text search applied to the displayed entries |

## Controls

- **Pause / Resume** — Stop and resume the live stream. While paused, entries arriving from the backend are not added to the view.
- **Clear** — Empty the local view without affecting the backend buffer.
- **Copy** — Copy the currently visible (filtered and searched) entries to the clipboard.
- **Follow scrolling** — The view scrolls to the newest entry automatically. Scrolling up pauses following; scrolling back to the bottom resumes it.

If entries were evicted before you opened the tab, a notice above the view reports how many earlier entries were dropped.

## Limits and Behavior

- The buffer is **in-memory** on the Manager backend and holds up to **2,000** entries (`DEFAULTS.LOGS.BUFFER_CAPACITY`). Older entries are evicted first.
- Individual entries are truncated at **4,000** characters (`DEFAULTS.LOGS.MAX_ENTRY_LENGTH`).
- The buffer is **cleared when the Manager process restarts**. When the frontend detects a backend restart it resets its view and re-polls from the start.
- **Child-process capture is production-only.** In development the OpenCode server inherits the terminal, so only Manager lines appear in the tab.
- The frontend polls the backend every **3 seconds** (`DEFAULTS.LOGS.POLL_INTERVAL_MS`); backend pages are capped at 1,000 entries per response.
- `docker-compose logs` remains the fallback for failures that happen **before** the Manager's HTTP server is up — nothing can be captured in-app at that point.
