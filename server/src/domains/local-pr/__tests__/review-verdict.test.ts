import { describe, expect, it } from 'vitest';
import { parseReviewVerdict } from '../review-verdict.js';

describe('parseReviewVerdict', () => {
  it('prioritizes the newest explicit failure and captures notes', () => {
    const content = `${'x'.repeat(2100)} [REVIEW_FAILED]`;

    expect(parseReviewVerdict([{ content }, { content: 'Older pass [REVIEW_PASSED]' }])).toEqual({
      passed: false,
      sawExplicitVerdict: true,
      reviewNotes: content.slice(-2000),
    });
  });

  it('recognizes pass verdicts and reports missing explicit verdicts', () => {
    expect(parseReviewVerdict([{ content: 'Looks good [REVIEW_PASSED]' }])).toEqual({
      passed: true,
      sawExplicitVerdict: true,
      reviewNotes: '',
    });
    expect(parseReviewVerdict([{ content: 'No marker yet' }])).toEqual({
      passed: false,
      sawExplicitVerdict: false,
      reviewNotes: '',
    });
  });
});
