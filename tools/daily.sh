#!/bin/sh
# Once a day, after the machine is switched on: restart whatever experiment queue stopped, write the gate
# result of any v2 seed that finished into docs/GATE.md, and show where every run is. Nothing is committed:
# check `git diff docs/GATE.md` first.
cd "$(dirname "$0")/.."
tools/resume.sh
echo
nice -n 19 node tools/tally.mjs runs/V1* runs/V20 2>/dev/null
git diff --quiet docs/GATE.md || echo "docs/GATE.md updated: review with git diff, then commit"
