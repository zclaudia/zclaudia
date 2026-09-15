import { describe, expect, it } from 'vitest';
import {
  groupNotificationsByDay,
  notificationStatus,
  notificationSubject,
  notificationTime,
} from '../presenter';

const SESSION_ID = '019f8e45-f0b3-7728-a750-e75915bb989f';

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    title: 'Run completed: Claude Test',
    status: 'completed',
    source: 'manual',
    ownerBackendId: 'local',
    createdAt: Date.now(),
    ...overrides,
  } as never;
}

describe('notificationSubject', () => {
  it('drops the status prefix the dot already carries', () => {
    expect(notificationSubject(makeItem())).toEqual({ text: 'Claude Test', isOpaqueId: false });
  });

  it('shortens an unnamed session down to a recognizable id', () => {
    const subject = notificationSubject(
      makeItem({ title: `Run failed: ${SESSION_ID}`, status: 'failed' })
    );
    expect(subject).toEqual({ text: '019f8e45', isOpaqueId: true });
  });

  it('keeps a prefix that disagrees with the item status', () => {
    // A "completed" word on a failed row is not ours to reinterpret.
    const subject = notificationSubject(
      makeItem({ title: 'Run completed: Nightly', status: 'failed' })
    );
    expect(subject.text).toBe('Run completed: Nightly');
  });

  it('passes unrecognized titles through verbatim', () => {
    const subject = notificationSubject(makeItem({ title: 'Gateway task finished' }));
    expect(subject).toEqual({ text: 'Gateway task finished', isOpaqueId: false });
  });

  it('falls back to the raw title when stripping would empty the row', () => {
    expect(notificationSubject(makeItem({ title: 'Run completed:' })).text).toBe('Run completed:');
  });
});

describe('notificationTime', () => {
  const now = new Date('2026-09-14T15:30:00').getTime();

  it('reads relative inside the first hour', () => {
    expect(notificationTime(now - 30_000, now)).toBe('just now');
    expect(notificationTime(now - 7 * 60_000, now)).toBe('7m ago');
  });

  it('falls back to a clock time once the group header carries the date', () => {
    expect(notificationTime(new Date('2026-09-12T09:05:00').getTime(), now)).toMatch(/9|09/);
  });
});

describe('groupNotificationsByDay', () => {
  const now = new Date('2026-09-14T15:30:00').getTime();
  const at = (iso: string) => new Date(iso).getTime();

  it('labels the recent days by name and older ones by date', () => {
    const groups = groupNotificationsByDay(
      [
        makeItem({ id: 'a', createdAt: at('2026-09-14T15:00:00') }),
        makeItem({ id: 'b', createdAt: at('2026-09-14T09:00:00') }),
        makeItem({ id: 'c', createdAt: at('2026-09-13T22:00:00') }),
        makeItem({ id: 'd', createdAt: at('2026-07-28T22:00:00') }),
      ],
      now
    );
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', expect.stringContaining('28')]);
    expect(groups[0].items.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('groups contiguously so server ordering is never rearranged', () => {
    const groups = groupNotificationsByDay(
      [
        makeItem({ id: 'a', createdAt: at('2026-09-14T15:00:00') }),
        makeItem({ id: 'b', createdAt: at('2026-09-13T09:00:00') }),
        makeItem({ id: 'c', createdAt: at('2026-09-14T08:00:00') }),
      ],
      now
    );
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('returns nothing for an empty feed', () => {
    expect(groupNotificationsByDay([], now)).toEqual([]);
  });
});

describe('notificationStatus', () => {
  it('maps every status onto a semantic tone and a spoken label', () => {
    expect(notificationStatus('failed')).toEqual({ tone: 'destructive', label: 'Failed' });
    expect(notificationStatus('running')).toEqual({ tone: 'warning', label: 'Running' });
    expect(notificationStatus('completed')).toEqual({ tone: 'success', label: 'Completed' });
  });
});
