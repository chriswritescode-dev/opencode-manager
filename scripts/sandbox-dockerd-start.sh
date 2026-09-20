#!/bin/sh
set -u

lock=/var/run/ocm-dockerd.lock
log=/var/log/dockerd.log
ready_timeout=60
lock_wait=120
socket=unix:///var/run/docker.sock

probe() {
    timeout 5 env -u DOCKER_HOST -u DOCKER_CONTEXT docker -H "$socket" info >/dev/null 2>&1
}

probe && exit 0

if [ "$(id -u)" -ne 0 ]; then
    exec sudo -n "$0" "$@"
fi

exec 9>"$lock"
flock -w "$lock_wait" 9 || exit 1

probe && exit 0

if [ -f /var/run/docker.pid ] && kill -0 "$(cat /var/run/docker.pid)" 2>/dev/null; then
    :
else
    setsid dockerd >"$log" 2>&1 </dev/null 9>&- &
fi

deadline=$(($(date +%s) + ready_timeout))
while [ "$(date +%s)" -lt "$deadline" ]; do
    probe && exit 0
    sleep 1
done

echo "dockerd did not become ready within ${ready_timeout}s; tail of $log:" >&2
tail -n 20 "$log" 2>/dev/null >&2
exit 1
