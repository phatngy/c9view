import { describe, expect, it } from 'vitest';
import { formatProjectNameHint, projectNameHints } from './projectNames.js';

describe('projectNameHints', () => {
  it('adds the parent folder only to colliding names', () => {
    expect(
      projectNameHints([
        { id: 'one', name: 'app', path: '/home/alex/personal/app' },
        { id: 'two', name: 'app', path: '/home/alex/work/app' },
        { id: 'unique', name: 'other', path: '/home/alex/other' },
      ]),
    ).toEqual(
      new Map([
        ['one', { path: 'personal' }],
        ['two', { path: 'work' }],
      ]),
    );
  });

  it('caps deep hints at two parent folders and marks the shortened path', () => {
    expect(
      projectNameHints([
        { id: 'one', name: 'app', path: '/home/alex/personal/app' },
        { id: 'two', name: 'app', path: '/home/sam/personal/app' },
      ]),
    ).toEqual(
      new Map([
        ['one', { path: '…/alex/personal' }],
        ['two', { path: '…/sam/personal' }],
      ]),
    );
  });

  it('numbers identical paths in plain code-unit ID order', () => {
    const hints = projectNameHints([
      {
        id: '-home-alex-code-personal-website-cloner',
        name: 'website-cloner',
        path: '/work/website-cloner',
      },
      {
        id: '-home-alex-code-personal',
        name: 'website-cloner',
        path: '/work/website-cloner',
      },
    ]);
    expect(hints.get('-home-alex-code-personal')).toEqual({
      path: 'work',
      ordinal: 1,
    });
    expect(hints.get('-home-alex-code-personal-website-cloner')).toEqual({
      path: 'work',
      ordinal: 2,
    });
    expect(formatProjectNameHint(hints.get('-home-alex-code-personal')!)).toBe(
      'work #1',
    );
  });

  it('numbers colliding empty hints without using encoded ID tails', () => {
    expect(
      projectNameHints([
        { id: 'first-a1234', name: 'app', path: 'app' },
        { id: 'second-a1234', name: 'app', path: 'app' },
      ]),
    ).toEqual(
      new Map([
        ['first-a1234', { path: '', ordinal: 1 }],
        ['second-a1234', { path: '', ordinal: 2 }],
      ]),
    );
  });
});
