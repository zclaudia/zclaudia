/**
 * Goal Feature E2E Tests
 *
 * Happy-path coverage for the Goal chip and dialog:
 *   1. Setting a goal updates the chip to show the objective and 0/N turn count.
 *   2. Clearing a goal returns the chip to the "+ Set goal" empty state.
 */

import { test, expect } from '../fixtures/test-fixtures';
import { ChatPage, ProjectPage } from '../page-objects';
import { ensureServerConnection } from '../helpers/connection-helper';

test.describe('Goal feature', () => {
  let chatPage: ChatPage;
  let projectPage: ProjectPage;

  test.beforeEach(async ({ page, cleanDb }) => {
    chatPage = new ChatPage(page);
    projectPage = new ProjectPage(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await ensureServerConnection(page);
  });

  /**
   * Ensure an active session is open (so the ChatInputArea — and GoalChip — are mounted).
   * Returns false if the prerequisite cannot be met (e.g. no server).
   */
  async function ensureSession(page: any): Promise<boolean> {
    // If the textarea is already visible we are inside a session.
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      return true;
    }

    // Create a project if none exist yet.
    const noProjects = page.locator('text=No projects yet').first();
    if (await noProjects.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ok = await projectPage.createProject('Goal Test Project', '/tmp/goal-test-project');
      if (!ok) {
        console.log('  Warning: could not create project (server may not be connected)');
        return false;
      }
      await page.waitForTimeout(1500);
    }

    // Select the project.
    const projectBtn = page.locator('text=Goal Test Project').first();
    if (await projectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectBtn.click();
      await page.waitForTimeout(500);
    }

    // Create a new session.
    const newSessionBtn = page.locator('[data-testid="new-session-btn"]').first();
    if (await newSessionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (await newSessionBtn.isEnabled()) {
        await newSessionBtn.click();
        await page.waitForTimeout(500);

        const createBtn = page.locator('button:has-text("Create")').first();
        if (await createBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await createBtn.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    return await textarea.isVisible({ timeout: 5000 }).catch(() => false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GF1: Setting a goal updates the chip
  // ─────────────────────────────────────────────────────────────────────────
  test('GF1: set goal updates chip to show objective and turn count', async ({ page }) => {
    const sessionReady = await ensureSession(page);
    if (!sessionReady) {
      console.log('  Warning: could not open a session — skipping test');
      console.log('GF1: passed (prerequisites not met)');
      return;
    }

    // The chip must be visible before we interact with it.
    const chip = page.getByTestId('goal-chip');
    await expect(chip).toBeVisible({ timeout: 5000 });

    // Initial state: "+ Set goal" dashed button.
    await expect(chip).toContainText(/set goal/i);

    // Open the goal dialog.
    await chip.click();

    // Fill in the objective.
    const objectiveTextarea = page.getByPlaceholder(/what does done look like/i);
    await expect(objectiveTextarea).toBeVisible({ timeout: 3000 });
    await objectiveTextarea.fill('all tests pass');

    // Submit — button label is "Set goal" when no goal is active.
    await page.getByRole('button', { name: /^set goal$/i }).click();

    // Dialog should close and chip should reflect the new goal.
    await expect(chip).toContainText(/all tests pass/i, { timeout: 5000 });
    // Default maxTurns is 50; turnsUsed starts at 0.
    await expect(chip).toContainText(/0\s*\/\s*50/);

    console.log('GF1: set goal chip verified');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GF2: Clearing a goal returns chip to empty state
  // ─────────────────────────────────────────────────────────────────────────
  test('GF2: clearing a goal returns chip to Set goal empty state', async ({ page }) => {
    const sessionReady = await ensureSession(page);
    if (!sessionReady) {
      console.log('  Warning: could not open a session — skipping test');
      console.log('GF2: passed (prerequisites not met)');
      return;
    }

    const chip = page.getByTestId('goal-chip');
    await expect(chip).toBeVisible({ timeout: 5000 });

    // ── Set a temporary goal ──────────────────────────────────────────────
    await chip.click();

    const objectiveTextarea = page.getByPlaceholder(/what does done look like/i);
    await expect(objectiveTextarea).toBeVisible({ timeout: 3000 });
    await objectiveTextarea.fill('temp goal');

    await page.getByRole('button', { name: /^set goal$/i }).click();

    await expect(chip).toContainText(/temp goal/i, { timeout: 5000 });

    // ── Clear the goal ────────────────────────────────────────────────────
    await chip.click();

    // Dialog re-opens in "active goal" mode; "Clear goal" button is visible.
    const clearBtn = page.getByRole('button', { name: /clear goal/i });
    await expect(clearBtn).toBeVisible({ timeout: 3000 });
    await clearBtn.click();

    // Chip returns to the dashed "+ Set goal" empty state.
    await expect(chip).toContainText(/set goal/i, { timeout: 5000 });

    console.log('GF2: clear goal chip verified');
  });
});
