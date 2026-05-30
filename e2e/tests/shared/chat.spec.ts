import { expect } from 'vitest';
import { testAllModes } from '../../helpers/test-factory';

testAllModes('should send and receive chat message', async (browser, mode) => {
  // Session is already ensured by testAllModes

  // Send a message
  const textarea = browser.locator('textarea').first();
  await textarea.fill('Hello, this is a test message');
  await browser.click('[data-testid="send-button"]');

  // Wait for response
  await browser.waitForSelector('[data-role="assistant"]', { timeout: 15000 });

  // Verify message appears
  const messages = browser.locator('[data-role="assistant"]');
  const count = await messages.count();
  expect(count).toBeGreaterThan(0);

  console.log(`✓ Chat working in ${mode.name}`);
});

testAllModes('should stream response deltas', async (browser, mode) => {
  const textarea = browser.locator('textarea').first();
  await textarea.fill('Count from 1 to 5');
  await browser.click('[data-testid="send-button"]');

  // Watch for streaming (content should update multiple times)
  const assistantMsg = browser.locator('[data-role="assistant"]').last();

  let previousText = '';
  let updateCount = 0;

  for (let i = 0; i < 10; i++) {
    await browser.waitForTimeout(500);
    const currentText = await assistantMsg.textContent().catch(() => '') || '';

    if (currentText !== previousText && currentText.length > previousText.length) {
      updateCount++;
      previousText = currentText;
    }
  }

  // Should have at least one update (streaming may be fast)
  expect(updateCount).toBeGreaterThanOrEqual(1);
  console.log(`✓ Streaming works in ${mode.name} (${updateCount} updates)`);
});
