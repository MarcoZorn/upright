#!/bin/sh
# Runs the v2 seeds (docs/PREREG-V2.md), 3 at a time, 7 workers each (~70% of 32 cores). Resumable: rerun it.
cd "$(dirname "$0")/.."
seq 11 20 | xargs -P 3 -I{} sh -c '
  mkdir -p runs/V{}
  [ -f runs/V{}/state.json ] && [ "$(node -e "const s=require(\"./runs/V{}/state.json\");console.log(s.gen>=1000||s.stage>=3?1:0)")" = 1 ] && exit 0
  g=$(node -e "try{console.log(require(\"./runs/V{}/state.json\").gen)}catch{console.log(0)}")
  nice -n 19 node train.mjs --run runs/V{} --seed {} --pairs 256 --sigma 0.03 --lr 0.01 --l2 0.005 --noise 16000000 \
    --hidden 64 --assist 1 --assistPeriod 6 --until 3 --gens $((1000 - g)) --workers 7 >> runs/V{}/stdout.txt 2>&1'
