const REVIEW_PASSED_RE = /\[REVIEW_PASSED\]/i;
const REVIEW_FAILED_RE = /\[REVIEW_FAILED\]/i;

export interface ReviewMessageContent {
  content: string;
}

export interface ReviewVerdict {
  passed: boolean;
  reviewNotes: string;
  sawExplicitVerdict: boolean;
}

export function parseReviewVerdict(messages: ReviewMessageContent[]): ReviewVerdict {
  for (const msg of messages) {
    if (REVIEW_FAILED_RE.test(msg.content)) {
      return {
        passed: false,
        reviewNotes: msg.content.slice(-2000),
        sawExplicitVerdict: true,
      };
    }
    if (REVIEW_PASSED_RE.test(msg.content)) {
      return {
        passed: true,
        reviewNotes: '',
        sawExplicitVerdict: true,
      };
    }
  }

  return {
    passed: false,
    reviewNotes: '',
    sawExplicitVerdict: false,
  };
}
