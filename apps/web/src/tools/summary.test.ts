import { describe, expect, it } from 'vitest';
import {
  countReadLines,
  countGrepResult,
  displayToolName,
  parseExit,
  resultBadge,
  toolDuration,
  toolSummary,
} from './summary.js';
import type { ToolResult, ToolUse } from './ToolCard.js';
const result = (text: string, isError = false): ToolResult => ({
  type: 'tool_result',
  toolUseId: 't',
  text,
  isError,
});
const tool = (name: string, input: unknown = {}): ToolUse => ({
  type: 'tool_use',
  id: 't',
  name,
  input,
});
describe('tool summaries', () => {
  it.each([
    '1\tfirst\n2\tsecond\n<system-reminder>note</system-reminder>',
    '     1→first\n     2→second\n<system-reminder>note</system-reminder>',
  ])('counts only numbered Read lines', (text) => {
    expect(countReadLines(text)).toBe(2);
    const summary = toolSummary(
      tool('Read', { file_path: '/root/a', offset: 1 }),
      [result(text)],
      { projectId: 'p', projectPath: '/root' },
    );
    expect(summary.badge?.text).toBe('2 lines');
    expect(summary.detail).toBe('lines 1–2');
    expect(summary.summary[0]?.href).toContain('path=a&line=1');
  });
  it('handles empty, pending and failed Read', () => {
    expect(toolSummary(tool('Read'), [result('')]).badge?.text).toBe('0 lines');
    expect(toolSummary(tool('Read')).badge?.text).toBe('pending');
    expect(
      toolSummary(tool('Read', { offset: 4 }), [result('bad', true)]).detail,
    ).toBe('from line 4');
    expect(toolSummary(tool('Read'), [result('bad', true)]).badge?.tone).toBe(
      'danger',
    );
  });
  it.each([
    ['Found 3 files\na\nb\nc', '3 files'],
    ['Found 1 file\na', '1 file'],
    ['Found 9 total occurrences across 2 files.', '9 matches'],
    ['Found 1 total occurrence across 1 file.', '1 match'],
    ['No files found', 'no matches'],
    ['No matches found', 'no matches'],
    ['a.ts:1:x\na.ts:3:y', '2 matches'],
    ['unrecognized\noutput', '2 lines'],
  ])('parses Grep %s', (text, expected) =>
    expect(countGrepResult(text)).toBe(expected),
  );
  it('summarizes Grep options and Glob truncation', () => {
    expect(
      toolSummary(tool('Grep', { pattern: 'needle', glob: '*.ts' }), [
        result('a.ts:1:needle'),
      ]),
    ).toMatchObject({
      summary: [{ text: 'needle', mono: true }],
      detail: 'in *.ts',
      badge: { text: '1 match' },
    });
    expect(
      toolSummary(tool('Glob', { pattern: '*.ts', path: '/root' }), [
        result('a.ts\nb.ts\n(Results are truncated…)'),
      ]).badge?.text,
    ).toBe('2 files');
    expect(
      toolSummary(tool('Glob'), [result('No files found')]).badge?.text,
    ).toBe('no files');
  });
  it.each([
    ['ok', false, {}, 'exit 0'],
    ['Exit code 2\nfailed', true, {}, 'exit 2'],
    ['Permission to use Bash here has been denied.', true, {}, 'denied'],
    ['ok', false, { run_in_background: true }, 'background'],
    ['Command running in background with ID: 1', false, {}, 'background'],
    ['[Request interrupted by user]', true, {}, 'interrupted'],
    ['ok\nExit code 2\nnot actually an exit header', false, {}, 'exit 0'],
    ['The output mentions [Request interrupted later', false, {}, 'exit 0'],
    ['error: [Request interrupted later', true, {}, 'interrupted'],
    ['failed', true, {}, 'error'],
  ])('parses Bash %s', (text, error, input, expected) => {
    expect(parseExit([result(text, error)], input)).toBe(expected);
    expect(
      toolSummary(tool('Bash', input), [result(text, error)]).badge?.text,
    ).toBe(expected);
  });
  it('shows Bash duration only for completed runs', () => {
    const ctx = {
      callAt: '2026-01-01T00:00:00Z',
      resultAt: '2026-01-01T00:00:01Z',
    };
    expect(
      toolSummary(tool('Bash', { command: 'pwd' }), [result('ok')], ctx).badge,
    ).toEqual({ text: 'exit 0 · 1s', tone: 'success' });
    expect(parseExit([])).toBe('running');
    expect(toolSummary(tool('Bash'), [], ctx).badge?.text).toBe('running');
    expect(
      toolSummary(tool('Bash'), [result('[Request interrupted]', true)], ctx)
        .badge?.tone,
    ).toBe('muted');
  });
  it.each(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])(
    'summarizes %s diffs',
    (name) => {
      const block = {
        ...tool(name, { file_path: 'a.ts', notebook_path: 'a.ts' }),
        change: {
          filePath: 'a.ts',
          kind: 'create' as const,
          additions: 3,
          deletions: 2,
          truncated: false,
          hunks: [],
        },
      };
      expect(toolSummary(block, [result('ok')])).toMatchObject({
        tone: 'edit',
        diff: { additions: 3, deletions: 2 },
      });
      expect(toolSummary(tool(name), [result('ok')]).badge?.text).toBe(
        'edited',
      );
    },
  );
  it.each(['BashOutput', 'KillShell', 'KillBash', 'TaskStop'])(
    'summarizes %s',
    (name) =>
      expect(
        toolSummary(tool(name, { task_id: 'id' }), [result('ok')]),
      ).toMatchObject({
        tone: 'run',
        summary: [{ text: 'id', mono: true }],
        badge: { text: 'done' },
      }),
  );
  it('summarizes web calls', () => {
    expect(
      toolSummary(tool('WebFetch', { url: 'https://example.com/path' }), [
        result('a\nb'),
      ]),
    ).toMatchObject({
      tone: 'search',
      summary: [{ text: 'example.com/path', mono: true }],
      badge: { text: '2 lines' },
    });
    expect(
      toolSummary(tool('WebSearch', { query: 'query' }), [result('ok')]).badge
        ?.text,
    ).toBe('done');
  });
  it.each(['Task', 'Agent'])('summarizes %s metadata and async', (name) => {
    expect(
      toolSummary(
        tool(name, {
          description: 'Review',
          subagent_type: 'Explore',
          model: 'sonnet',
        }),
        [result('Async agent launched')],
      ),
    ).toMatchObject({ detail: 'Explore · sonnet', badge: { text: 'async' } });
    expect(toolSummary(tool(name)).badge?.text).toBe('running');
  });
  it('summarizes Todos and questions', () => {
    expect(
      toolSummary(
        tool('TodoWrite', {
          todos: [{ status: 'completed' }, { status: 'pending' }],
        }),
      ).badge?.text,
    ).toBe('1 of 2 done');
    expect(
      toolSummary(
        tool('AskUserQuestion', {
          questions: [{ question: 'A?' }, { question: 'B?' }],
        }),
      ),
    ).toMatchObject({
      summary: [{ text: 'A? (+1 more)', mono: false }],
      badge: { text: 'waiting', tone: 'accent' },
    });
    expect(
      toolSummary(tool('AskUserQuestion', { answers: {} })).badge?.text,
    ).toBe('answered');
    expect(
      toolSummary(tool('AskUserQuestion'), [result('bad', true)]).badge?.text,
    ).toBe('failed');
  });
  it.each(['ExitPlanMode', 'EnterPlanMode', 'plan'])(
    'summarizes %s approval',
    (name) => {
      expect(
        toolSummary(tool(name, { plan: '\nFirst line\nNext' }), [
          result('approved'),
        ]),
      ).toMatchObject({
        summary: [{ text: 'First line', mono: false }],
        badge: { text: 'approved' },
      });
      expect(
        toolSummary(tool(name), [result('not approved')]).badge?.text,
      ).toBe('not approved');
      expect(toolSummary(tool(name), [result('unapproved')]).badge?.text).toBe(
        'not approved',
      );
      expect(toolSummary(tool(name)).badge?.text).toBe('pending');
    },
  );
  it.each(['Skill', 'SlashCommand', 'ToolSearch'])('summarizes %s', (name) =>
    expect(
      toolSummary(tool(name, { skill: 'do', command: 'do', query: 'do' }), [
        result('ok'),
      ]),
    ).toMatchObject({
      summary: [{ text: 'do', mono: true }],
      badge: { text: 'done' },
    }),
  );
  it('splits MCP names and keeps unknown tools', () => {
    expect(displayToolName('mcp__github__search')).toEqual({
      server: 'github',
      name: 'search',
    });
    expect(
      toolSummary(tool('mcp__github__search', { query: 'x'.repeat(100) }), [
        result('one'),
      ]),
    ).toMatchObject({
      name: 'search',
      summary: [{ text: 'x'.repeat(80) }],
      badge: { text: '1 lines' },
    });
    expect(toolSummary(tool('Custom', { value: 'hello' }))).toMatchObject({
      name: 'Custom',
      summary: [{ text: 'hello' }],
      badge: { text: 'pending' },
    });
    expect(resultBadge([result('bad', true)])).toEqual({
      text: 'error',
      tone: 'danger',
    });
  });
  it('bounds and formats durations', () => {
    const start = '2026-01-01T00:00:00Z';
    expect(toolDuration(start, '2026-01-01T00:00:00.030Z')).toBe('<1s');
    expect(toolDuration(start, start)).toBe('<1s');
    expect(toolDuration(start, '2026-01-01T06:00:00Z')).toBe('360m 0s');
    for (const end of [
      'invalid',
      '2025-12-31T23:59:59Z',
      '2026-01-01T06:00:01Z',
    ])
      expect(toolDuration(start, end)).toBeUndefined();
    expect(toolDuration(undefined, start)).toBeUndefined();
    expect(toolDuration(start, null)).toBeUndefined();
  });
});
