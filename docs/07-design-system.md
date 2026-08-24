# 07 · Design System

**Strictly monochrome, light mode. No colour anywhere.** The character comes from
restraint + generous whitespace, drawn from Notion (paper calm), Apple
(recede-so-content-speaks) and Linear (density), with all colour removed.

## Tokens (`src/app/globals.css`)

| Token | Value | Use |
|-------|-------|-----|
| `--canvas` | `#ffffff` | Page background |
| `--surface` | `#fafafa` | Cards / inset panels |
| `--surface-2` | `#f4f4f5` | Muted fills, badges |
| `--ink` | `#18181b` | Text, primary buttons |
| `--ink-muted` | `#6b6b70` | Secondary text |
| `--ink-subtle` | `#9b9ba1` | Meta, captions |
| `--hairline` | `#e7e7e9` | Borders / dividers |
| `--hairline-strong` | `#d6d6d9` | Inputs, emphasis borders |

## Rules

- **No colour, no shadows.** Depth = surface change + 1px hairline only.
  **One deliberate exception:** the confidence dot (below).
- **Font: Manrope**, single family. Headings tight (`-0.02em`), body 400.
- **Radii:** 8px default, 12px cards. Not pills (this is an app, not marketing).
- **Confidence — the one place colour is used (traffic light).** The `ConfidenceDot`
  encodes certainty by colour: `high` = green, `medium` = amber, `low` = red,
  `unknown` = neutral dashed outline (see `ConfidenceDot` in `ui/badge.tsx`).
  This intentionally breaks the monochrome rule: confidence is the one signal
  Colin scans at a glance, and a traffic light reads faster than a fill-weight.
  It is the **only** sanctioned colour in the UI — do not introduce colour
  elsewhere. (Was previously fill-weight: solid ink / grey / outline / dashed.)
- **Buttons:** `primary` = ink fill / white text; `secondary` = hairline border;
  `ghost` = text only. Focus ring is ink.
- **Layout:** centred `max-w-content` (1180px), hairline top bar, `.eyebrow`
  uppercase micro-labels for section headers.

## Primitives (`src/components/ui/`)

`Button`, `Card`/`CardHeader`/`CardBody`, `Input`/`Select`/`Label`,
`Badge`/`ConfidenceDot`/`StatusBadge`. Keep new primitives here and monochrome —
the traffic-light `ConfidenceDot` is the sole exception.
