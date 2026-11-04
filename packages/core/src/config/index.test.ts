import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('uses defaults and parses delimited workspace roots', () => {
    const config = loadConfig({
      HOME: '/home/tester',
      XDG_CACHE_HOME: '/tmp/test-cache',
      C9VIEW_WORKSPACE_ROOTS: `/work/one${process.platform === 'win32' ? ';' : ':'}/work/two`,
    });
    expect(config).toEqual({
      claudeDir: `${homedir()}/.claude`,
      workspaceRoots: ['/work/one', '/work/two'],
      dbPath: '/tmp/test-cache/c9view/index.sqlite',
    });
  });

  it('expands home references in overrides', () => {
    expect(
      loadConfig({
        HOME: '/home/tester',
        C9VIEW_CLAUDE_DIR: '~/data/claude',
        C9VIEW_WORKSPACE_ROOTS: '~/work',
        C9VIEW_DB: '~/cache/index.sqlite',
      }),
    ).toEqual({
      claudeDir: `${homedir()}/data/claude`,
      workspaceRoots: [`${homedir()}/work`],
      dbPath: `${homedir()}/cache/index.sqlite`,
    });
  });
});
