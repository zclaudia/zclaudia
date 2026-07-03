# Terminal ANSI 16-Color Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make colored terminal output readable in light themes by generating ANSI 16-color tokens through the existing token pipeline and mapping them into xterm.js, with `minimumContrastRatio: 4.5` as a safety net.

**Architecture:** The desktop app already generates per-theme CSS variables from `apps/desktop/scripts/tokens/config.mjs` via `pnpm gen:tokens`. We add 16 `terminal-ansi-*` tokens to the shared light/dark accent sets (all five themes regenerate automatically), extend `getTerminalTheme()` in `XTerminal.tsx` to map them into xterm's `ITheme`, and add `minimumContrastRatio` to the `Terminal` constructor in `TerminalController.ts`.

**Tech Stack:** React + xterm.js (`@xterm/xterm`), Vitest + Testing Library (jsdom), Node token generator script.

**Spec:** `docs/superpowers/specs/2026-07-03-terminal-ansi-palette-design.md`

## Global Constraints

- Token names are exactly `terminal-ansi-<slot>` with kebab-case bright slots (e.g. `terminal-ansi-bright-black`).
- Both light themes share one ANSI set; all three dark themes share one set (same sharing model as existing accents).
- `--terminal-bg` / `--terminal-fg` / `--terminal-cursor` / `--terminal-selection` values must NOT change.
- Never hand-edit the `@generated:tokens` blocks in `apps/desktop/src/styles/index.css` — only `config.mjs` + `pnpm gen:tokens`.
- All commands below run from the repo root. The desktop package filter is `@zclaudia/desktop`.
- `docs/superpowers/` is gitignored in this repo; committed spec/plan files were force-added. You do not need to commit any docs in these tasks.

---

### Task 1: ANSI tokens in the token pipeline

**Files:**
- Modify: `apps/desktop/scripts/tokens/config.mjs` (after the `darkGlyphs` block, around line 32; then spread into `lightAccents` / `darkAccents`)
- Generated: `apps/desktop/src/styles/index.css` (via `pnpm gen:tokens`, do not hand-edit)

**Interfaces:**
- Consumes: existing `lightAccents` / `darkAccents` objects in `config.mjs`.
- Produces: CSS variables `--terminal-ansi-black` … `--terminal-ansi-bright-white` (16 per theme) in every theme block of `index.css`. Task 2 reads these exact names.

- [ ] **Step 1: Add the two ANSI palette objects to `config.mjs`**

Insert after the `darkGlyphs` object (before `const lightAccents`):

```js
// Terminal ANSI 16-color palette — hue-anchored to the accent/glyph system
// (red 4 = destructive, green 150 = success, yellow 38-44 = warning,
// blue 214 = primary, magenta 285 ≈ glyph-purple, cyan 185-190 ≈ glyph-teal).
// white/bright-white stay deliberately light: their semantic role is background
// blocks and reverse video; foreground use is rescued by xterm's
// minimumContrastRatio (see TerminalController).
const lightAnsi = {
  'terminal-ansi-black': [45, 8, 16],
  'terminal-ansi-red': [4, 66, 45],
  'terminal-ansi-green': [150, 48, 33],
  'terminal-ansi-yellow': [38, 80, 38],
  'terminal-ansi-blue': [214, 70, 45],
  'terminal-ansi-magenta': [285, 45, 48],
  'terminal-ansi-cyan': [190, 65, 32],
  'terminal-ansi-white': [45, 6, 78],
  'terminal-ansi-bright-black': [45, 5, 43],
  'terminal-ansi-bright-red': [4, 70, 52],
  'terminal-ansi-bright-green': [150, 45, 40],
  'terminal-ansi-bright-yellow': [40, 78, 45],
  'terminal-ansi-bright-blue': [214, 70, 56],
  'terminal-ansi-bright-magenta': [285, 50, 58],
  'terminal-ansi-bright-cyan': [190, 60, 40],
  'terminal-ansi-bright-white': [45, 10, 88],
};

const darkAnsi = {
  'terminal-ansi-black': [35, 6, 22],
  'terminal-ansi-red': [4, 60, 62],
  'terminal-ansi-green': [150, 40, 56],
  'terminal-ansi-yellow': [42, 65, 60],
  'terminal-ansi-blue': [214, 62, 64],
  'terminal-ansi-magenta': [285, 45, 68],
  'terminal-ansi-cyan': [185, 45, 56],
  'terminal-ansi-white': [35, 10, 80],
  'terminal-ansi-bright-black': [35, 6, 45],
  'terminal-ansi-bright-red': [4, 65, 68],
  'terminal-ansi-bright-green': [150, 42, 63],
  'terminal-ansi-bright-yellow': [44, 70, 66],
  'terminal-ansi-bright-blue': [214, 65, 70],
  'terminal-ansi-bright-magenta': [285, 50, 74],
  'terminal-ansi-bright-cyan': [185, 50, 63],
  'terminal-ansi-bright-white': [35, 12, 93],
};
```

- [ ] **Step 2: Spread the sets into the accent objects**

In `lightAccents`, next to the existing `...lightGlyphs` spread, add `...lightAnsi`:

```js
const lightAccents = {
  // ... existing entries unchanged ...
  ...lightGlyphs,
  ...lightAnsi,
};
```

In `darkAccents`, next to `...darkGlyphs`, add `...darkAnsi`:

```js
const darkAccents = {
  // ... existing entries unchanged ...
  ...darkGlyphs,
  ...darkAnsi,
};
```

- [ ] **Step 3: Regenerate index.css**

Run: `pnpm --filter @zclaudia/desktop run gen:tokens`
Expected output: `index.css theme tokens regenerated.`

- [ ] **Step 4: Verify all five theme blocks got the variables**

Run: `grep -c -- '--terminal-ansi-' apps/desktop/src/styles/index.css`
Expected: `80` (16 variables × 5 themes)

Run: `grep -- '--terminal-ansi-yellow' apps/desktop/src/styles/index.css`
Expected: 5 lines — two light values `38 80% 38%`, three dark values `42 65% 60%`.

- [ ] **Step 5: Verify the generator round-trips clean**

Run: `pnpm --filter @zclaudia/desktop run gen:tokens:check`
Expected output: `gen-tokens --check: clean.`

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts/tokens/config.mjs apps/desktop/src/styles/index.css
git commit -m "feat(terminal): add ANSI 16-color theme tokens"
```

---

### Task 2: Map ANSI tokens into the xterm theme

**Files:**
- Modify: `apps/desktop/src/components/terminal/XTerminal.tsx:48-57` (the `getTerminalTheme` function — also add `export` to it)
- Test: `apps/desktop/src/components/terminal/__tests__/XTerminal.test.tsx`

**Interfaces:**
- Consumes: CSS variables `--terminal-ansi-*` from Task 1; existing module-private `hslToHex` helper in `XTerminal.tsx`.
- Produces: `export function getTerminalTheme(): ITheme` returning all 16 ANSI fields (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `brightBlack`, `brightRed`, `brightGreen`, `brightYellow`, `brightBlue`, `brightMagenta`, `brightCyan`, `brightWhite`) plus the existing 4 fields. No consumer changes needed — `TerminalController.refreshTheme()` already re-reads the whole object on theme switches.

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/components/terminal/__tests__/XTerminal.test.tsx`, change the import on line 75 from:

```ts
import { XTerminal } from '../XTerminal';
```

to:

```ts
import { XTerminal, getTerminalTheme } from '../XTerminal';
```

Then add inside the existing `describe('XTerminal', ...)` block (after the `'applies theme from CSS variables'` test):

```ts
it('maps all 16 ANSI palette slots from CSS variables', () => {
  // Each slot gets a distinct primary color so a crossed wire fails loudly.
  const values: Record<string, string> = {
    '--terminal-bg': '0 0% 0%',
    '--terminal-fg': '0 0% 100%',
    '--terminal-cursor': '0 0% 100%',
    '--terminal-selection': '0 0% 50%',
    '--terminal-ansi-black': '0 0% 0%',
    '--terminal-ansi-red': '0 100% 50%',
    '--terminal-ansi-green': '120 100% 50%',
    '--terminal-ansi-yellow': '60 100% 50%',
    '--terminal-ansi-blue': '240 100% 50%',
    '--terminal-ansi-magenta': '300 100% 50%',
    '--terminal-ansi-cyan': '180 100% 50%',
    '--terminal-ansi-white': '0 0% 100%',
    '--terminal-ansi-bright-black': '0 0% 50%',
    '--terminal-ansi-bright-red': '0 100% 25%',
    '--terminal-ansi-bright-green': '120 100% 25%',
    '--terminal-ansi-bright-yellow': '60 100% 25%',
    '--terminal-ansi-bright-blue': '240 100% 25%',
    '--terminal-ansi-bright-magenta': '300 100% 25%',
    '--terminal-ansi-bright-cyan': '180 100% 25%',
    '--terminal-ansi-bright-white': '0 0% 75%',
  };
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (prop: string) => values[prop] || '',
  } as any);

  const theme = getTerminalTheme();

  expect(theme).toMatchObject({
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffffff',
    selectionBackground: '#808080',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    yellow: '#ffff00',
    blue: '#0000ff',
    magenta: '#ff00ff',
    cyan: '#00ffff',
    white: '#ffffff',
    brightBlack: '#808080',
    brightRed: '#800000',
    brightGreen: '#008000',
    brightYellow: '#808000',
    brightBlue: '#000080',
    brightMagenta: '#800080',
    brightCyan: '#008080',
    brightWhite: '#bfbfbf',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zclaudia/desktop exec vitest run src/components/terminal/__tests__/XTerminal.test.tsx`
Expected: FAIL — `getTerminalTheme` is not exported (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Extend and export `getTerminalTheme`**

In `apps/desktop/src/components/terminal/XTerminal.tsx`, replace the whole function (lines 48-57) with:

```ts
export function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const get = (v: string) => hslToHex(style.getPropertyValue(v).trim());
  return {
    background: get('--terminal-bg'),
    foreground: get('--terminal-fg'),
    cursor: get('--terminal-cursor'),
    selectionBackground: get('--terminal-selection'),
    black: get('--terminal-ansi-black'),
    red: get('--terminal-ansi-red'),
    green: get('--terminal-ansi-green'),
    yellow: get('--terminal-ansi-yellow'),
    blue: get('--terminal-ansi-blue'),
    magenta: get('--terminal-ansi-magenta'),
    cyan: get('--terminal-ansi-cyan'),
    white: get('--terminal-ansi-white'),
    brightBlack: get('--terminal-ansi-bright-black'),
    brightRed: get('--terminal-ansi-bright-red'),
    brightGreen: get('--terminal-ansi-bright-green'),
    brightYellow: get('--terminal-ansi-bright-yellow'),
    brightBlue: get('--terminal-ansi-bright-blue'),
    brightMagenta: get('--terminal-ansi-bright-magenta'),
    brightCyan: get('--terminal-ansi-bright-cyan'),
    brightWhite: get('--terminal-ansi-bright-white'),
  };
}
```

Nothing else in the file changes — `buildDeps` already passes `getTheme: getTerminalTheme`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zclaudia/desktop exec vitest run src/components/terminal/__tests__/XTerminal.test.tsx`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/terminal/XTerminal.tsx apps/desktop/src/components/terminal/__tests__/XTerminal.test.tsx
git commit -m "feat(terminal): map ANSI 16-color tokens into the xterm theme"
```

---

### Task 3: minimumContrastRatio safety net

**Files:**
- Modify: `apps/desktop/src/services/terminal/TerminalController.ts:304-310` (the `new Terminal({...})` options in `ensureTerminal`)
- Test: Create `apps/desktop/src/services/terminal/__tests__/TerminalController.construction.test.ts`

**Interfaces:**
- Consumes: `TerminalController` class and its `TerminalControllerDeps` (constructor takes `{ terminalId, sendMessage, getTheme }`; `open({ projectId })` triggers terminal construction). No `factories` override — this test exercises the real construction branch, which the existing `TerminalController.test.ts` deliberately bypasses.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/services/terminal/__tests__/TerminalController.construction.test.ts`:

```ts
/**
 * Covers the real (non-factories) xterm construction branch of ensureTerminal,
 * which TerminalController.test.ts deliberately bypasses via the factories hook.
 */
import { describe, it, expect, vi } from 'vitest';

const ctorOptions = vi.hoisted(() => [] as any[]);

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    write = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    options: any = {};
    cols = 80;
    rows = 24;
    constructor(opts: any) {
      ctorOptions.push(opts);
    }
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

import { TerminalController } from '../TerminalController';

describe('TerminalController xterm construction', () => {
  it('constructs the Terminal with a 4.5 minimum contrast ratio and the deps theme', () => {
    const theme = { background: '#000000' };
    const controller = new TerminalController({
      terminalId: 'term-1',
      sendMessage: vi.fn(),
      getTheme: () => theme,
    });

    controller.open({ projectId: 'proj-1' });

    expect(ctorOptions).toHaveLength(1);
    expect(ctorOptions[0].minimumContrastRatio).toBe(4.5);
    expect(ctorOptions[0].theme).toBe(theme);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zclaudia/desktop exec vitest run src/services/terminal/__tests__/TerminalController.construction.test.ts`
Expected: FAIL — `expected undefined to be 4.5` (the constructor currently receives no `minimumContrastRatio`).

- [ ] **Step 3: Add the option**

In `apps/desktop/src/services/terminal/TerminalController.ts`, `ensureTerminal()`, change the default construction to:

```ts
      : new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: resolveMonoFontFamily(),
          theme,
          allowProposedApi: true,
          // Safety net for colors the theme palette can't control (256-color /
          // truecolor output, and white/bright-white used as foreground).
          minimumContrastRatio: 4.5,
        });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zclaudia/desktop exec vitest run src/services/terminal/__tests__/TerminalController.construction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/services/terminal/TerminalController.ts apps/desktop/src/services/terminal/__tests__/TerminalController.construction.test.ts
git commit -m "feat(terminal): enforce minimum contrast ratio in xterm"
```

---

### Task 4: Full verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: green suite; evidence for completion claims.

- [ ] **Step 1: Run the full desktop test suite**

Run: `pnpm --filter @zclaudia/desktop test`
Expected: all suites PASS (the terminal suites: XTerminal, TerminalController, TerminalController.construction, TerminalPanel, TerminalWindow, TerminalLifecycle, TerminalRegistry, useTerminalController).

- [ ] **Step 2: Confirm generated CSS is committed and clean**

Run: `pnpm --filter @zclaudia/desktop run gen:tokens:check && git status --short apps/desktop`
Expected: `gen-tokens --check: clean.` and no unstaged changes under `apps/desktop`.

- [ ] **Step 3: Manual smoke pass (human checkpoint)**

Launch `pnpm desktop:dev`, open the Terminal panel, and for each of the five themes (light, light-cool, dark, dark-warm, dark-cool) check:
- starship prompt: cyan path + yellow language version readable
- `git diff` output: red/green/cyan hunks readable
- `ls` colors and a yellow-background block (e.g. `npm warn` output)

Report results to the user; the spec's mockup (https://claude.ai/code/artifact/d4a67ea4-51c8-4307-8f19-94c493c14788) shows the expected look.
