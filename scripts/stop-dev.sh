#!/usr/bin/env bash
# Stops everything `pnpm dev` starts, plus any agent left running.
#
# Killing by port is not enough: `tsx watch` supervises its child, so killing
# the process holding the port just makes the supervisor spawn a new one. That
# is how a simulated desk ends up quietly reconnecting to a real controller
# hours later. Kill the supervisors first, then anything left.
set -uo pipefail

patterns=(
  "turbo run dev"
  "tsx watch src/index.ts"
  "vite/bin/vite.js"
  "cli.mjs src/index.ts"
)

for pattern in "${patterns[@]}"; do
  pgrep -f "$pattern" >/dev/null 2>&1 && pkill -f "$pattern" 2>/dev/null
done
sleep 2

# Anything that ignored SIGTERM.
for pattern in "${patterns[@]}"; do
  pgrep -f "$pattern" >/dev/null 2>&1 && pkill -9 -f "$pattern" 2>/dev/null
done

remaining=0
for port in 7420 5173 7430; do
  if ss -lptn "sport = :$port" 2>/dev/null | grep -q pid=; then
    echo "port $port still in use"
    remaining=1
  fi
done
[ "$remaining" -eq 0 ] && echo "dev environment stopped"
exit 0
