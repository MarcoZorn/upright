#!/bin/sh
# NEAT baseline mutation-scale sweep (docs/DEVLOG.md, 2026-11-08). Waits for the v2 seeds so the two never
# share the 70% CPU budget, then gives each setting 100 gens (~51k episodes, ~1/10 of the ES budget) on seed 1.
cd "$(dirname "$0")/.."
while pgrep -f "tools/v2.sh" > /dev/null; do sleep 300; done
for step in 0.005 0.02 0.05; do
  mkdir -p runs/neat-w$step
  nice -n 19 node neat.mjs --run runs/neat-w$step --seed 1 --pop 256 --gens 100 --workers 21 --assistPeriod 6 \
    --initWeight 0 --pWeightReplace 0 --weightStep $step >> runs/neat-w$step/stdout.txt 2>&1
done
