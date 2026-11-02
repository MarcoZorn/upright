# Pre-registration: gait transitions across gravity

Written before any training at g ≠ 9.81. The commit that adds this file is the timestamp.

## Question
Does a humanoid that learned to walk and run by itself pick its gait by Froude number, Fr = v² / (g·L), the way people and other animals do? And does it start to *skip* in lunar gravity?

## Background
- People switch from walking to running near Fr ≈ 0.5 on Earth.
- In simulated and real reduced gravity, the transition speed falls roughly with √g. Measured lunar transitions sit somewhat above the Fr = 0.5 prediction (Kram et al. 1997; De Witt et al. 2014).
- Optimal-control simulations of human gait predict skipping at lunar gravity and mixed gaits at Martian gravity (Ackermann & van den Bogert 2012).
- As far as I could find, nobody has tested a *learned* 3D humanoid across gravities.

## Setup (fixed in advance)
- Body, senses, PD motors and solver settings as in `src/body.js` and `src/sim.js` at the commit that adds this file. Leg length L = 0.92 m (hip height).
- Gravity: 9.81 (Earth), 3.71 (Mars), 1.62 (Moon).
- One speed-conditioned policy per gravity, trained **from scratch at that gravity**, with the same algorithm, the same budget in episodes, and 5 seeds.
- The CPG's inter-leg phase and frequency are learned, never fixed, so neither skipping nor a cadence change is ruled out by construction.
- The plain-MLP arm (no CPG) must reproduce any gait claim before it is reported.

## Measurements (`src/gait.js`)
For commanded speeds in a sweep from 0.2 to the fastest stable speed, over the last 5 s of 10 s episodes at 8 seeds each:
- duty factor
- flight fraction
- cadence
- inter-leg phase Δφ
- skip rate (same-foot consecutive touchdowns)
- Froude number of the achieved speed

**Walk→run transition:** the lowest commanded speed at which the mean duty factor drops below 0.5 with flight fraction > 0.05, measured in both an accelerating and a decelerating sweep.

## Hypotheses
- **H1:** the walk→run transition occurs at Fr = 0.5 ± 0.15 at all three gravities.
- **H2:** at g = 1.62, the preferred gait above Fr 0.3 has skip rate > 0.3 or |Δφ − π| > 1 rad, in at least 3 of 5 seeds.

## Kill criteria and reporting
- If no policy reaches a stable walk (1 m/s for 10 s on 8 of 10 seeds) on Earth, the experiment is not run, and the repo says so.
- If the transitions depend on the energy weight (`0.0005 × power`) by more than ±0.15 Fr across {0.5×, 1×, 2×}, the result is reported as reward-dependent rather than physical.
- Results are reported whatever their direction, with every seed shown. Brains and replay hashes are published so anyone can rerun them in a browser.
