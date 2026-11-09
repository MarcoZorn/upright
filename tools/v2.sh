#!/bin/sh
# Runs the v2 seeds (docs/PREREG-V2.md), 3 at a time, 7 workers each (~70% of 32 cores). Resumable: rerun it.
# Recipe flags only on a fresh start: on resume, command-line flags override the saved state, and passing them
# again reset sigma and the help after a reboot (2026-11-09, see PREREG-V2.md).
cd "$(dirname "$0")/.."
seq 11 20 | xargs -P 3 -I{} sh -c '
  mkdir -p runs/V{}
  if [ -f runs/V{}/state.json ]; then
    eval $(node -e "const s=require(\"./runs/V{}/state.json\");console.log(\"g=\"+s.gen+\" done=\"+(s.gen>=1000||s.stage>=3?1:0))")
    [ "$done" = 1 ] && exit 0
    flags="--run runs/V{}"
  else
    g=0
    flags="--run runs/V{} --seed {} --pairs 256 --sigma 0.01 --lr 0.01 --l2 0.005 --noise 16000000 --hidden 64 --assist 1 --assistPeriod 6 --until 3"
  fi
  nice -n 19 node train.mjs $flags --gens $((1000 - g)) --workers 7 >> runs/V{}/stdout.txt 2>&1'
