# Airwright Platform — Context Docs

This folder is the source of truth for **anyone (human or AI) picking up this repo**.
Read these in order before making changes.

| # | Doc | What it covers |
|---|-----|----------------|
| 00 | [Project overview](./00-project-overview.md) | Who Airwright is, the business, the "one rate" spine |
| 01 | [Tech stack](./01-tech-stack.md) | The chosen stack and why |
| 02 | [PRD — Build 1](./02-prd-build1.md) | Quote & Take-off Engine requirements |
| 03 | [Domain glossary](./03-domain-glossary.md) | LM, lift, birdcage, gable, Haki, etc. |
| 04 | [Data model](./04-data-model.md) | The Prisma schema explained |
| 05 | [Week 1 scope](./05-week1-scope.md) | What this codebase delivers right now |
| 06 | [Setup guide](./06-setup.md) | Supabase, Render, env vars, deploy |
| 07 | [Design system](./07-design-system.md) | Monochrome UI rules |
| 08 | [Colin's data](./08-colin-data.md) | Real drawings + pricing matrices decoded (Week 3 input) |

## Where we are

**Phase 1 → Build 1 (Quote & Take-off Engine, ~7 weeks) → Week 1 complete.**
The pipeline runs end to end: upload a tender PDF → background extraction via
Claude → review the drawing beside the extracted fields.

## The golden rule

**Two correctness rules must come from Colin (Airwright's estimator) directly,
never inferred:** (1) how wall height maps to number of lifts, and (2) the exact
percentage splits for erect / birdcage / dismantle. Do not harden the pricing
engine (Week 4) until these are confirmed. See [PRD](./02-prd-build1.md).
