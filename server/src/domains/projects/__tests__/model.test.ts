import { describe, expect, it } from 'vitest';
import {
  applyProjectPatch,
  buildProjectCreateState,
  buildProjectPatch,
  isProjectValidationError,
} from '../model.js';
import type { Project } from '@zclaudia/shared/core/project';

describe('projects model', () => {
  it('builds create state with defaults and trims name', () => {
    const state = buildProjectCreateState({ name: '  Demo  ' }, 3);

    expect(state).toMatchObject({
      name: 'Demo',
      type: 'code',
      sortOrder: 3,
    });
  });

  it('rejects blank project names as validation errors', () => {
    const act = () => buildProjectCreateState({ name: '   ' }, 0);

    expect(act).toThrow('Name is required');
    try {
      act();
    } catch (error) {
      expect(isProjectValidationError(error)).toBe(true);
    }
  });

  it('builds patch objects with explicit null clearing', () => {
    const patch = buildProjectPatch({
      name: '  Updated  ',
      rootPath: null,
      reviewLlmProfileId: null,
    });

    expect(patch).toEqual({
      name: 'Updated',
      rootPath: null,
      reviewLlmProfileId: null,
    });
  });

  it('applies patch onto existing project state for validation', () => {
    const existing = {
      id: 'p1',
      name: 'Original',
      type: 'code',
      rootPath: '/repo',
      reviewLlmProfileId: 'reviewer',
      createdAt: 1,
      updatedAt: 1,
    } as Project;

    const nextState = applyProjectPatch(
      existing,
      buildProjectPatch({
        type: 'chat_only',
        reviewLlmProfileId: null,
      })
    );

    expect(nextState).toMatchObject({
      name: 'Original',
      type: 'chat_only',
      rootPath: '/repo',
      reviewLlmProfileId: undefined,
    });
  });

  it('rejects patches that clear required fields', () => {
    const existing = {
      id: 'p1',
      name: 'Original',
      type: 'code',
      createdAt: 1,
      updatedAt: 1,
    } as Project;

    expect(() => applyProjectPatch(existing, buildProjectPatch({ name: null }))).toThrow(
      'Name is required'
    );
    expect(() => applyProjectPatch(existing, buildProjectPatch({ type: null }))).toThrow(
      'Type is required'
    );
  });
});

describe('projects model: additional paths', () => {
  it('defaults additionalPaths to an empty list on create', () => {
    expect(buildProjectCreateState({ name: 'Demo' }, 0).additionalPaths).toEqual([]);
  });

  it('rejects malformed additionalPaths as a validation error', () => {
    for (const bad of ['/a', [1], { a: 1 }]) {
      try {
        buildProjectPatch({ additionalPaths: bad });
        throw new Error('expected throw');
      } catch (error) {
        expect(isProjectValidationError(error)).toBe(true);
      }
    }
  });

  it('patches additionalPaths and treats null as clearing', () => {
    expect(buildProjectPatch({ additionalPaths: ['/a'] }).additionalPaths).toEqual(['/a']);
    expect(buildProjectPatch({ additionalPaths: null }).additionalPaths).toBeNull();
    const existing = {
      id: 'p',
      name: 'n',
      type: 'code',
      rootPath: '/r',
      additionalPaths: ['/a'],
      createdAt: 1,
      updatedAt: 1,
    } as Project;
    expect(applyProjectPatch(existing, { additionalPaths: null }).additionalPaths).toEqual([]);
    expect(applyProjectPatch(existing, {}).additionalPaths).toEqual(['/a']);
  });

  it('refuses additional directories on chat-only or rootless projects', () => {
    expect(() =>
      buildProjectCreateState(
        { name: 'x', type: 'chat_only', rootPath: '/r', additionalPaths: ['/a'] },
        0
      )
    ).toThrow(/only/);
    expect(() => buildProjectCreateState({ name: 'x', additionalPaths: ['/a'] }, 0)).toThrow(
      /only/
    );
  });
});
