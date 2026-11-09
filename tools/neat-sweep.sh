#!/bin/sh
# NEAT baseline mutation-scale sweep (docs/DEVLOG.md, 2026-11-08). Waits for the v2 seeds so the two never
# share the 70% CPU budget, then gives each setting 100 gens (~51k episodes, ~1/10 of the ES budget) on seed 1.
cd "$(dirname "$0")/.."
while pgrep -f "tools/v2.sh" > /dev/null; do sleep 300; done
for step in 0.005 0.02 0.05; do
  d=runs/neat-w$step; mkdir -p $d
  # resumable: neat.mjs counts --gens from where it resumes, so pass only what's left
  g=$(node -e "try{console.log(require('./$d/state.json').generation)}catch{console.log(0)}")
  [ "$g" -ge 100 ] && continue
  nice -n 19 node neat.mjs --run $d --seed 1 --pop 256 --gens $((100 - g)) --workers 21 --assistPeriod 6 \
    --initWeight 0 --pWeightReplace 0 --weightStep $step >> $d/stdout.txt 2>&1
done
