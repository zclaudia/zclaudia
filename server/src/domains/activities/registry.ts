import type { Activity, ActivityResult, ActivityServices } from './types.js';

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

  async invoke(
    type: string,
    input: Record<string, unknown>,
    services: ActivityServices,
  ): Promise<ActivityResult> {
    const activity = this.activities.get(type);
    if (!activity) {
      return { status: 'failed', output: {}, error: `Unknown activity: ${type}` };
    }
    return activity.invoke(input, services);
  }
}
