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
| 11 | [Take-off engine spec](./11-takeoff-engine-spec.md) | **Canonical build spec** — post-Colin rules, extractor field set, validation set, open questions. (Old drafts 09/10 deleted — superseded by this + the live code) |

## Where we are

**Phase 1 → Build 1 → Weeks 1–2 complete; Week 3 core built and validated
(2026-08-19).** The pipeline runs end to end on real multi-builder packs (Miller,
Bloor-NSS, Bloor-Oadby): upload PDF/ZIP → classify → extract observables (Opus,
prompt v2026-08-19.2) → the deterministic take-off engine emits Colin's take-off
line per configuration — matching his handwritten sheets (Dekker 20.56/10.66 vs
his 20.5/10.6; Rosewood 48.5 exact). Next: the Colin follow-up on the open
questions, then ScaffoldOperation rows + pricing (Week 4).

## The golden rule

**Nothing uncertain is guessed.** Doc 11 §8 lists the 16 open rule questions
(corner allowance quantum, height datum, birdcage cavity, render table, rate
sheet…) with owners — each is a configurable hook + review flag until Colin
answers it. Stage splits (50/25/25; bungalow 65/10/25) are confirmed from his
matrices. Do not harden pricing (Week 4) until the rate sheet lands. See
[doc 11](./11-takeoff-engine-spec.md).
