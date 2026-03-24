#!/bin/bash
set -e

export PATH="/opt/bun/bin:/opt/opencode/bin:/usr/local/bin:$PATH"
export BUN_INSTALL="/opt/bun"

START_COMMAND="bun backend/src/index.ts"
WORK_DIR="/opt/opencode-manager"
export MAXIMIZE="true"
export MAXIMIZE_NAME="Chromium"
MAXIMIZE_SCRIPT=$STARTUPDIR/maximize_window.sh

/usr/bin/desktop_ready

if [ -z "$AUTH_SECRET" ]; then
    export AUTH_SECRET=$(openssl rand -base64 32)
fi

BROWSER=$(which chromium-browser || which chromium || which google-chrome || echo "")

set +e
while true; do
    if ! pgrep -f "$START_COMMAND" > /dev/null; then
        cd "$WORK_DIR"
        $START_COMMAND > /tmp/opencode-manager.log 2>&1 &
        sleep 3
        if [ -n "$BROWSER" ]; then
            if ! pgrep -f "$BROWSER" > /dev/null; then
                bash ${MAXIMIZE_SCRIPT} 2>/dev/null &
                $BROWSER \
                    --no-first-run \
                    --no-default-browser-check \
                    --disable-gpu \
                    --start-maximized \
                    --window-position=0,0 \
                    "http://localhost:5003" &
            fi
        fi
    fi
    sleep 1
done
