# Amendment 3 to the pre-registration (2026-11-06)

**Change to training, not to the gate.** From now on, the walk stage graduates at a mean of 0.9 m/s on its training evals instead of 0.8, a margin over the gate's 0.8 m/s. This fixes the flaw disclosed in amendment 2: graduates sitting on the gate's threshold.

**When.** Made while seeds 3 and 4 were still in the walk stage (best training-eval speed so far 0.63 and 0.70 m/s), before any gate result for them, and before seed 5 started.

**Unchanged.**
- Runs Y and Z keep their recorded results under amendment 2 (both fail). They are not retrained.
- The gate itself and the "8 of 10 training runs" requirement are unchanged.
- Since Y and Z already fail, at most 8 of 10 can pass, which happens only if all eight remaining runs pass.
