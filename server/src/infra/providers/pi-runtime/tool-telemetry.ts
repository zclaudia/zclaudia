export interface ToolTelemetrySnapshot {
  totalCalls: number;
  toolCounts: Record<string, number>;
  repeatedReads: Record<string, number>;
  repeatedMutations: Record<string, number>;
  bashRoutingBlocked: number;
  outputBytes: number;
}

export interface ToolTelemetryRecord {
  snapshot: ToolTelemetrySnapshot;
  notable: boolean;
  advisories: string[];
}

type ToolResultLike = {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
};

function textBytes(content: ToolResultLike['content']): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return sum;
    return sum + Buffer.byteLength(block.text, 'utf8');
  }, 0);
}

function pathArg(args: Record<string, unknown> | undefined): string | undefined {
  const value = args?.path ?? args?.file_path ?? args?.filePath;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function increment(map: Map<string, number>, key: string): number {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  return next;
}

function mapAboveOne(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].filter(([, count]) => count > 1));
}

export class ToolCallTelemetry {
  private totalCalls = 0;
  private outputBytes = 0;
  private bashRoutingBlocked = 0;
  private readonly toolCounts = new Map<string, number>();
  private readonly readsByPath = new Map<string, number>();
  private readonly mutationsByPath = new Map<string, number>();

  record(toolName: string, args: Record<string, unknown> | undefined, result: ToolResultLike): ToolTelemetryRecord {
    const advisories: string[] = [];
    this.totalCalls += 1;
    this.outputBytes += textBytes(result.content);
    increment(this.toolCounts, toolName || '<unknown>');

    const path = pathArg(args);
    if (toolName === 'Read' && path) {
      const count = increment(this.readsByPath, path);
      if (count === 2) {
        advisories.push(`Read has returned ${path} twice in this run. Reuse the existing snapshot unless another tool changed that file.`);
      }
    }

    if ((toolName === 'Edit' || toolName === 'Write') && path) {
      const count = increment(this.mutationsByPath, path);
      if (count === 3) {
        advisories.push(`${toolName} has now mutated ${path} ${count} times in this run. Prefer batching related changes into one Edit/Write when possible.`);
      }
    }

    if (toolName === 'Bash' && result.details?.error === 'bash_tool_routing_blocked') {
      this.bashRoutingBlocked += 1;
    }

    const snapshot = this.snapshot();
    return {
      snapshot,
      notable: advisories.length > 0 || result.details?.error === 'bash_tool_routing_blocked',
      advisories,
    };
  }

  snapshot(): ToolTelemetrySnapshot {
    return {
      totalCalls: this.totalCalls,
      toolCounts: Object.fromEntries(this.toolCounts.entries()),
      repeatedReads: mapAboveOne(this.readsByPath),
      repeatedMutations: mapAboveOne(this.mutationsByPath),
      bashRoutingBlocked: this.bashRoutingBlocked,
      outputBytes: this.outputBytes,
    };
  }
}
