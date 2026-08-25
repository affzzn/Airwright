# 07 · Design System

**Strictly monochrome, light mode. No colour anywhere.** The character comes from
restraint + generous whitespace, drawn from Notion (paper calm), Apple
(recede-so-content-speaks) and Linear (density), with all colour removed. The
ground is a **warm off-white paper**; **cards are pure white** and lift off it
with a hairline — the depth is that page↔card surface change, never a shadow.

## Tokens (`src/app/globals.css`)

The palette is warm-biased (no hue). **`--page` is the page ground only** (body,
shell, login). **`--canvas` is the card / input / modal / badge surface** — kept
pure white so cards lift off the warm page. Never use `--canvas` for a page
background or `--page` for a card.

| Token | Value | Use |
|-------|-------|-----|
| `--page` | `#f7f6f3` | **Page background** (body / shell / login) |
| `--canvas` | `#ffffff` | **Card / input / modal / badge surface** |
| `--surface` | `#f3f1ed` | Inset panels, hover fills |
| `--surface-2` | `#ebe8e2` | Muted fills, badges |
| `--ink` | `#1b1a17` | Text, primary buttons |
| `--ink-muted` | `#6b6862` | Secondary text |
| `--ink-subtle` | `#9a978d` | Meta, captions |
| `--hairline` | `#e8e5df` | Borders / dividers |
| `--hairline-strong` | `#d8d4cc` | Inputs, emphasis borders |

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
  uppercase micro-labels for section headers. `AppShell variant="workspace"`
  drops the centred column for a viewport-height frame (desktop only) — used by
  the **review screen**, where the drawing is fixed (PDF viewer `fit="contain"`)
  and only the take-off pane scrolls, so there is one scrollbar, not two. Below
  `lg` it reverts to page scroll. The **active nav item** carries a flush 2px ink
  underline (`AppHeader`, from `usePathname`).
- **Floating layers:** the modal and the provenance tooltip are the only
  elevated surfaces (soft neutral `shadow-overlay`). The tooltip is **portaled to
  `<body>`** so a scrolling pane never clips it.

## Primitives (`src/components/ui/`)

`Button`, `Card`/`CardHeader`/`CardBody`, `Input`/`Select`/`Label`,
`Badge`/`ConfidenceDot`/`StatusBadge`. Keep new primitives here and monochrome —
the traffic-light `ConfidenceDot` is the sole exception.
