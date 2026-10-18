# Claude Runtime Phase D Capability Truthfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude advanced capability boundaries explicit and truthful before declaring the migration complete.

**Architecture:** Do not add AI review, multimodal, or background task support in this phase. Instead, keep Claude manifest and HTTP capabilities conservative, hide zclaudia-only multimodal fallback controls for Claude profiles, and update UI/docs so users see accurate limitations.

**Tech Stack:** TypeScript, Vitest, React Testing Library, PCP manifests, provider capabilities routes.

---

## Task 1: Tests

- [x] Add tests that Claude manifest keeps `input.image`, `input.text_file`, `input.binary_file`, and `session.background_task` unsupported.
- [x] Add tests that Claude HTTP capabilities keep AI review disabled.
- [x] Add ProfileEditor tests that Claude runtime hides multimodal fallback controls and does not save fallback config.

## Task 2: Implementation

- [x] Update ProfileEditor Claude limitation copy to name AI review, multimodal attachments/fallback, and background task controls.
- [x] Hide `MultimodalFallbackSelector` when runtime is Claude.
- [x] Ensure Claude save payload clears or omits `multimodalFallback`.

## Task 3: Verification

- [x] Run focused server and desktop tests.
- [x] Run server and desktop builds.
- [x] Run `git diff --check` and confirm `docs/superpowers` remains untracked.

## Self-Review

- This phase intentionally does not broaden Claude feature support.
- Capability declarations, UI affordances, and save payload behavior now agree.
- Future work can implement each advanced capability as a separate explicit phase.
