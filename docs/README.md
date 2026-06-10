# KnightPath docs — what lives where

The documentation contract (keep it this way — every new session relies on it):

| Doc | What it is | When to touch it |
|---|---|---|
| `../CLAUDE.md` | **The project bible.** Purpose, stack, page map, module map, the 12 project rules, current status. | Every release: status block + any new module/page/rule. Rules change ONLY with a logged rationale in learnings. |
| `learnings.md` | **The decisions log** (newest first). Records the *why* so future sessions don't undo deliberate choices. Reverted decisions get a note, never deleted. | Every release: one entry per version. Any rule deviation is logged here. |
| `design-system.md` | The brand/UI reference: tokens, type, buttons, layout, nav + the prioritised consistency backlog. | When a shared component or token changes, or backlog items complete. |
| `qa-checklist.md` | The human QA checklist; the Playwright suite in `../qa/` is its executable subset. | New page/behaviour → add a row first, then decide automation. Bump the reconciliation stamp. |
| `audit-2026-06-10.md` | The full repo audit + improvement plan (engineering + UX) and the cross-device-persistence build record. Implementation status annotated at top. | Point-in-time record — annotate status, don't rewrite history. |

Strategy docs live one level up in `../../docs/` (`super-app-roadmap.md` "Roadmap v4", `retention-and-gamification.md`).

**Discipline, in one line:** code change → learnings entry (the why) → CLAUDE.md status (the what) → qa-checklist row (the proof) — in the same commit.

**Also user-facing:** `../roadmap.html` is the public roadmap. Refresh its loops + "Coming next" + the "Updated" stamp as part of each release's doc pass — a stale roadmap reads as an abandoned product.
