---
# gstack: design-md-format=spec
name: OmniLaya Search
description: A typeset results page on cream paper, with Laya marking the margin in vermilion like an editor.
colors:
  paper: "#F4EEE3"
  sheet: "#FBF8F2"
  ink: "#1B1A17"
  pencil: "#635F57"
  rule: "#DDD3C2"
  fold: "#E7DFCF"
  box-border: "#CFC4B1"
  seal: "#B8321C"
  link: "#2B3A8C"
  visited: "#6B2F6B"
  success: "#2F6B3A"
  warning: "#8A5A12"
  error: "#B3261E"
  night-paper: "#15140F"
  night-sheet: "#1D1B16"
  night-ink: "#ECE5D6"
  night-pencil: "#A39C8E"
  night-rule: "#34312A"
  night-fold: "#221F18"
  night-box-border: "#45413A"
  night-seal: "#E4573D"
  night-link: "#9BA8F0"
  night-visited: "#C995C9"
  night-success: "#8FC79A"
  night-warning: "#E2B46B"
  night-error: "#F2877E"
typography:
  display:
    fontFamily: Shippori Mincho
    fontWeight: 700
    fontSize: clamp(40px, 6vw, 62px)
    letterSpacing: -0.02em
  print:
    fontFamily: Literata
    fontSize: 15px
    lineHeight: 1.6
  print-title:
    fontFamily: Literata
    fontWeight: 500
    fontSize: 19px
    lineHeight: 1.35
  sentence:
    fontFamily: Literata
    fontSize: 20px
    lineHeight: 1.5
  body:
    fontFamily: Hanken Grotesk
    fontSize: 15px
    lineHeight: 1.55
  label:
    fontFamily: Hanken Grotesk
    fontWeight: 600
    fontSize: 11px
    letterSpacing: 0.12em
  mono:
    fontFamily: Recursive
    fontSize: 12.5px
    letterSpacing: 0.01em
    fontVariation: "'MONO' 1, 'CASL' 0.6"
    fontFeature: tnum
rounded:
  xs: 4px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 14px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 56px
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  button-ghost:
    borderColor: "{colors.rule}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  search-box:
    backgroundColor: "{colors.sheet}"
    borderColor: "{colors.box-border}"
    rounded: "{rounded.xl}"
    height: 56px
  chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  chip-on:
    borderColor: "{colors.seal}"
    textColor: "{colors.seal}"
  margin-mark:
    textColor: "{colors.seal}"
    width: 184px
  answer-stamp:
    borderColor: "{colors.seal}"
    textColor: "{colors.seal}"
    rounded: "{rounded.xs}"
  cutting-floor:
    backgroundColor: "{colors.fold}"
    rounded: "{rounded.lg}"
  result-title:
    textColor: "{colors.link}"
---

# OmniLaya Search

## Overview

**Creative North Star:** The Proofreader's Desk. The results are the printed page, and Laya is the editor who marks it in the margin. This fits people who come to judge Laya itself: every decision it makes is visible, written where you read, and open to correction.

**Product context:** A web search that uses Laya, a small decision model, to choose sources, set a time window and score each result. Users are, in order: people following Laya and small decision models, self-hosters looking at the template, and everyday searchers who follow a shared link. The peer is Jev Search (jev.s1.dev), which OmniLaya started from.

**Mode per surface:**
- Home: Persuade. One search box, three example searches, the mark.
- Results: Read. Long-form result text, margin notes, no chrome competing with the page.
- Decision sentence, Ask Laya, cutting floor: Operate. Small controls that change what the page shows.
- Colophon: Read. How this page was made: model, checkpoint, timings, sources.

**Reference sites:** jev.s1.dev.

**Key characteristics:**
- Cream paper and black ink, with one red: the vermilion seal marks only what Laya decided.
- Result text is set in a book face, not a UI face.
- Laya speaks in a monospace hand in the margin, never inside the result.
- Every choice Laya made is underlined and can be tapped to change it.
- The page ends with a colophon, like a printed book.

## Colors

**Strategy:** Restrained. Paper, ink and pencil tones carry the page; one accent (seal) is reserved for Laya's marks, so a red mark always means "Laya decided this".

**Light or dark:** Light by default. People read results at a desk in daylight, and the paper metaphor depends on a light page. Night is a full theme, set by `data-theme="night"`, not an inversion.

- `seal` is for Laya only: margin scores, answer stamps, underlines in the decision sentence, the active chip, the slider accent. Nothing else is red.
- `link` and `visited` are classic ink blue and plum, so results read like links and visited state is clear.
- `pencil` is for metadata and secondary text. `rule` is for hairlines between rows; `fold` is for panels that sit behind the page (the cutting floor).
- Soft fills use `color-mix(in oklch, seal 12%, transparent)` (16% at night), not a new token.
- At night, paper is a warm near-black, never pure black. The seal and links get lighter so they keep the same contrast against the dark paper, and rules stay warm so rows still separate.

## Typography

Four faces, each with one job. All load from Google Fonts with `display=swap`.

- **Shippori Mincho** (500, 700): display only. The wordmark, the home heading, section heads. A Japanese Mincho with Latin glyphs; it echoes the ink-brush mark and keeps headings out of the usual serif set. Never for running text.
- **Literata** (400, 500, optical sizes): the printed page. Result titles, snippets and the decision sentence. Built for long reading on screens.
- **Hanken Grotesk** (400, 500, 600): interface. Inputs, buttons, chips, metadata, labels.
- **Recursive** with `MONO 1` and `CASL 0.6`: Laya's voice. Margin scores, the "read by" line, the colophon numbers, keyboard hints. The casual axis makes it look handwritten without being a script face. Use tabular figures for scores.

Scale: display clamps from 40 to 62px; sentence 20px; result title 19px; print 15px; UI 15px; meta 12.5px; labels 11px uppercase with 0.12em tracking.

## Layout

- Max width 1120px, 20px side padding.
- Results use two columns: the page (`minmax(0, 1fr)`) and a 184px margin, 28px gap. The margin has a faint seal-tinted left rule.
- Below 720px the margin column folds under each result as one wrapped line of marks. No horizontal scroll at 390px.
- Spacing runs on a 4px base. Rows are 18px top and bottom; sections are 56px apart, split by a dashed rule.
- The colophon closes the page with a double rule and an auto-fit grid of 190px minimum columns.

## Elevation & Depth

Flat paper. Depth comes from tone and rules, not shadows: `sheet` sits on `paper` for inputs and the search box, `fold` sits under the page for the cutting floor. Hairlines (`rule`) separate rows, dashed rules separate sections and mark optional controls. No drop shadows, no glows.

## Shapes

- 4px: answer stamps, kbd keys.
- 8px: chips, theme toggle.
- 10px: buttons, the Ask Laya field, the search button.
- 12px: the cutting floor, swatches.
- 14px: the search box (the outer shape; its 38px button inside uses 10px).

Stamps rotate slightly (-2 to -3 degrees) so they read as stamped by hand. Nothing else rotates.

## Components

- **Search box:** `sheet` fill, 1px `box-border`, 56px tall, 14px radius; ink submit button with an arrow. Focus shows a 2px seal outline offset 2px.
- **Decision sentence:** "Laya searched Google, DuckDuckGo and Yandex from any time." Each choice has a 2px seal underline and opens a picker on click or `e`. A struck choice is crossed out in seal and greyed. "+ add a place" has a dashed pencil underline. A Recursive line below says which checkpoint read it, how long it took and what the user changed.
- **Ask Laya:** a dashed field labelled "Ask Laya" in seal Recursive. Takes a yes/no question about the results. Two chips follow: "Sort by answer" and "Filter yes only". Chip-on uses a seal border, seal text and the soft seal fill.
- **Result row:** meta line (domain, date, how many engines found it), Literata title in `link`, snippet in ink at 80%. Hover underlines the title, offset 3px.
- **Margin mark:** score in seal Recursive ("91 on topic"), a 92px by 4px ink bar, then optional notes in pencil. The answer to an Ask Laya question is a rotated stamp ("official: yes 96").
- **Cutting floor:** a `fold` panel holding the threshold slider (seal accent). Rows below the line fold away, with a count of how many.
- **Disagree stamp:** an uppercase seal stamp on the row. Kept in local storage and exportable as JSONL.
- **Ink lenses:** saved source sets plus raise, lower or block per domain, stored locally.
- **Buttons:** primary is ink on paper; secondary is sheet with a 55% ink border; ghost is a dashed rule. Disabled drops to 45% opacity and loses the pointer.
- **Keyboard proofing:** `j`/`k` move between rows, `x` folds a row, `d` stamps disagree, `e` edits the decision sentence. The focused row shows a seal left rule.

## Do's and Don'ts

- Do: keep seal red for Laya's decisions only. If a red element is not something Laya chose or scored, it is wrong.
- Do: put Laya's scores and notes in the margin column, never as a badge inside the result text.
- Do: use Literata for anything a user reads at length, and Hanken Grotesk for anything a user operates.
- Do: let every underlined choice in the decision sentence be changed in one tap.
- Do: check the night theme and a 390px width for every new component.
- Don't: add a second accent color, gradients, or glass panels.
- Don't: use Shippori Mincho for body text or below 18px.
- Don't: add drop shadows or glows; use tone and rules for depth.
- Don't: use emoji or generic search icons from icon fonts; use the inline SVG set.
- Don't: show a spinner where the margin can write a mark as each score arrives.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms)
- **The one authored moment:** each margin mark is written in as its score arrives. The bar draws left to right and the number fades in, about 300ms, staggered by arrival order. With `prefers-reduced-motion`, marks appear without the draw.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-02 | Initial design system created | Created by /design-consultation from the user research in `.notes/`, a comparison with jev.s1.dev, and the approved "Proofreader's Desk" preview |
| 2026-10-02 | Vermilion seal used only for Laya's marks | Users come to judge the model, so its decisions need to stand out from everything else on the page |
| 2026-10-02 | Margin column replaces in-row relevance badges | Keeps the result text clean and gives Laya's notes a fixed place to be read |
| 2026-10-02 | Page ends with a colophon | Shows model, checkpoint and timings in one place, which is what model-curious users look for |
