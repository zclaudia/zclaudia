import type { Activity, ActivityResult, ActivityServices } from './types.js';
import type { WorkflowStepTypeMeta } from '@zclaudia/shared/features/workflows';

export class ActivityRegistry {
  private activities = new Map<string, Activity>();

  register(activity: Activity): void {
    if (this.activities.has(activity.type)) {
      throw new Error(`Activity already registered: ${activity.type}`);
    }
    this.activities.set(activity.type, activity);
  }

  has(type: string): boolean {
    return this.activities.has(type);
  }

  types(): string[] {
    return [...this.activities.keys()];
  }

  listMeta(): WorkflowStepTypeMeta[] {
    return [...this.activities.values()].map((a) => ({
      type: a.type,
      name: a.name,
      description: a.description,
      category: a.category,
      icon: a.icon,
      configSchema: a.configSchema,
      source: 'activity',
      supportsLoop: a.supportsLoop,
    }));
  }

  async invoke(
    type: string,
    input: Record<string, unknown>,
    services: ActivityServices,
  ): Promise<ActivityResult> {
    const activity = this.activities.get(type);
    if (!activity) {
      return { status: 'failed', output: {}, error: `Unknown activity: ${type}` };
    }
    const schema = activity.configSchema as { required?: string[] } | undefined;
    if (schema?.required?.length) {
      const config = (input ?? {}) as Record<string, unknown>;
      const missing = schema.required.filter((k) => config[k] === undefined);
      if (missing.length) {
        return { status: 'failed', output: {}, error: `Missing required config: ${missing.join(', ')}` };
      }
    }
    return activity.invoke(input, services);
  }
}
