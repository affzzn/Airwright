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
| 11 | [Take-off engine spec](./11-takeoff-engine-spec.md) | **Canonical take-off spec** — post-Colin rules, extractor field set, validation set, open questions |
| 12 | [Extraction prompt reference](./12-extraction-prompt-reference.md) | What we send the model (mechanics + verbatim prompt) |
| 13 | [Extraction playbook](./13-extraction-playbook.md) | **How the model reads each measurement** — the single source the prompt is generated from |
| 14 | [Pricing & quote](./14-pricing-and-quote.md) | **The priced side (BUILT)** — pricing engine, matrix, immutable quote, outputs |
| — | [Call checklist](./Airwright-Estimator-Build-Checklist_from_call.docx) | The 13 Aug Colin/Ben call digest (16 sections + open-rules table) |

(Docs 09/10 were pre-call drafts and were deleted — superseded by 11 + the checklist.)

## Where we are

**Whole pipeline built and DEPLOYED on Render (2026-08-20).** Drawing → AI extract
(Opus, prompt `2026-08-20.3`) → editable review with provenance page links →
**confirm/lock** → per-plot **pricing matrix** → **immutable quote** → Excel/print
outputs. Take-off engine matches Colin's handwritten sheets (Dekker 20.56/10.66;
Rosewood 48.5 exact). **Runs on placeholder rates** — Colin's rate sheet + the 16 open
questions are the one thing gating correct pricing. See [`PROGRESS.md`](../PROGRESS.md),
[doc 13](./13-extraction-playbook.md), [doc 14](./14-pricing-and-quote.md).

## The golden rule

**Nothing uncertain is guessed.** Doc 11 §8 lists the 16 open rule questions
(corner allowance quantum, height datum, birdcage cavity, render table, rate
sheet…) with owners — each is a configurable hook + review flag until Colin
answers it. Stage splits (50/25/25; bungalow 65/10/25) are confirmed from his
matrices. Do not harden pricing (Week 4) until the rate sheet lands. See
[doc 11](./11-takeoff-engine-spec.md).
