# 00 · Project Overview

## Who Airwright is

Airwright Midland is a **UK new-build scaffolding contractor** in the Midlands.
~£4m turnover, ~70 scaffolders, ~6 office staff, family-run:

- **Ben Wright** — MD, owner. Wants to grow to £6m **without adding office staff**.
- **Nicola** — Finance Director (Ben's mother). Owns Sage.
- **Laura** — sales / estimating support, holds the house-type "bank" (Excel).
- **Colin** — the estimator. The bottleneck: every quote waits on one person.
- **Pippa** — operations / billing (Strike Job Manager, applications for payment).

## What they do

Scaffold **housing developments** — not one house, a whole site of 100–150
plots built from a smaller set of **repeating house types** (e.g. "Wollaton",
"Chesterwood"). Also some **construction** work (bespoke, per-elevation).

## The "one rate" spine (the heart of the business)

The whole business hangs off **one meter rate**. That single rate becomes:

1. the **client quote** (what Airwright charges),
2. the **scaffolder / gang pay** (~31–35% of the rate),
3. the **monthly bill** to the client + **self-bill** to the gangs.

Today that rate is **keyed by hand into three separate places** (Excel → Strike →
back to Excel). The constraint on growth is **admin, not demand**.

## The incumbent system: Strike

Old desktop software (StrikeSoft Alpha). Clunky, vendor has stopped developing
it, its Sage finance link is broken. Ben wants to replace it — but **Strike stays
live through the transition** (existing cumulative jobs can't be migrated).

## Innate's engagement

- **Phase 1** = 3 linked builds: **Quote & Take-off Engine** (this repo, Build 1),
  One-Rate gang-pay, House-type bank.
- The full programme is 9 builds across two streams; ~£70k, ~16 weeks.
- Delivery is **phased, human-in-the-loop, low-disruption**. A person signs off
  every output. AI removes the re-typing; it never removes the judgement.

## The commercial context (why this matters)

Ben's plan: the AI becomes "the estimator", so he can hire a senior commercial
director without also hiring a replacement for Colin. **Accuracy and trust are
everything** — if the output isn't reliable and reconcilable the way Colin's
spreadsheets are, Airwright won't use it.
