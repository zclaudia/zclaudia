import { expect } from 'vitest';
import { testAllModes } from '../../helpers/test-factory';

testAllModes('should execute bash tool and show results', async (browser, mode) => {
  const textarea = browser.locator('textarea').first();
  await textarea.fill('Run: echo "Hello from bash"');
  await browser.click('[data-testid="send-button"]');

  // Wait for the assistant response to appear (tool execution completes)
  await browser.waitForSelector('[data-role="assistant"]', { timeout: 20000 });
  await browser.waitForTimeout(2000);

  // The tool call list may be collapsed - look for the "tool call" summary button and click it
  const collapsedSummary = browser.getByText(/tool call/);
  if (await collapsedSummary.isVisible({ timeout: 3000 }).catch(() => false)) {
    await collapsedSummary.click();
    await browser.waitForTimeout(500);
  }

  // Now look for individual tool-use item
  const toolUse = browser.locator('[data-testid="tool-use"]').first();
  await expect(toolUse).toBeVisible({ timeout: 5000 });

  // Verify tool name
  const toolName = browser.locator('[data-testid="tool-name"]').first();
  await expect(toolName).toContainText('Bash');

  // Click the tool call to expand it and see the result
  await toolUse.click();
  await browser.waitForTimeout(500);

  // Verify tool result appears after expanding
  const toolResult = browser.locator('[data-testid="tool-result"]').first();
  await expect(toolResult).toBeVisible({ timeout: 5000 });

  const resultText = await toolResult.textContent();
  expect(resultText).toContain('Hello from bash');

  console.log(`✓ Tool execution works in ${mode.name}`);
});
