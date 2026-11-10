#!/bin/sh
# Restart whatever experiment queue isn't running (after a reboot). Safe to run any time: a queue that is
# already running is left alone, and both queues resume from their checkpoints and skip finished runs.
cd "$(dirname "$0")/.."
for q in v2 neat-sweep; do
  if pgrep -f "^/bin/sh tools/$q.sh" > /dev/null; then echo "$q: running"
  else setsid nohup "tools/$q.sh" > /dev/null 2>&1 & echo "$q: started"
  fi
done
sleep 2
node tools/status.mjs runs/V1* runs/V20 runs/neat-w*
