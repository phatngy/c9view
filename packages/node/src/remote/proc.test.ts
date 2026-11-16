import { describe, expect, it, vi } from 'vitest';
import {
  createSelfIdentity,
  parseProcStart,
  readProcStart,
  sameProcess,
} from './proc.js';

// Fields 3..22 after the command: state, ppid, ..., starttime is field 22.
function stat(comm: string, start = '123456'): string {
  const rest = [
    'S',
    '1',
    '1',
    '1',
    '0',
    '-1',
    '4194560',
    '1',
    '0',
    '0',
    '0',
    '2',
    '1',
    '0',
    '0',
    '20',
    '0',
    '1',
    '0',
    start,
    '999',
  ];
  return `4242 (${comm}) ${rest.join(' ')}\n`;
}

describe('parseProcStart', () => {
  it('reads field 22 as a decimal string', () => {
    expect(parseProcStart(stat('node'))).toBe('123456');
  });
  it('handles spaces and parentheses in the command name', () => {
    expect(parseProcStart(stat('a b) (c) d'))).toBe('123456');
    expect(parseProcStart(stat(') 1 2 3 ('))).toBe('123456');
  });
  it.each([
    ['empty', ''],
    ['no parenthesis', '4242 node S 1 1'],
    ['too few fields', '4242 (node) S 1 1 1'],
    ['non-numeric start', stat('node', 'abc')],
    ['negative start', stat('node', '-5')],
    [
      'empty start',
      '4242 (node) S 1 1 1 0 -1 4194560 1 0 0 0 2 1 0 0 20 0 1 0',
    ],
  ])('returns null for %s', (_n, text) => {
    expect(parseProcStart(text)).toBeNull();
  });
});

describe('readProcStart', () => {
  it('reads /proc/<pid>/stat', () => {
    const read = vi.fn(() => stat('node', '77'));
    expect(readProcStart(31, read)).toBe('77');
    expect(read).toHaveBeenCalledWith('/proc/31/stat');
  });
  it('reads /proc/self/stat for self', () => {
    const read = vi.fn(() => stat('node', '78'));
    expect(readProcStart('self', read)).toBe('78');
    expect(read).toHaveBeenCalledWith('/proc/self/stat');
  });
  it('fails closed without leaking the proc error', () => {
    const read = () => {
      throw new Error('ENOENT /proc/31/stat secret-path');
    };
    expect(readProcStart(31, read)).toBeNull();
  });
  it('rejects invalid pids without reading', () => {
    const read = vi.fn(() => stat('node'));
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(readProcStart(pid, read)).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });
});

describe('createSelfIdentity', () => {
  it('returns the node pid and start, cached after success', () => {
    const read = vi.fn(() => stat('node', '500'));
    const self = createSelfIdentity(4242, read);
    expect(self()).toEqual({ pid: 4242, procStart: '500' });
    expect(self()).toEqual({ pid: 4242, procStart: '500' });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('fails closed on unreadable or malformed stat and retries later', () => {
    let text: string | Error = new Error('EACCES');
    const read = () => {
      if (text instanceof Error) throw text;
      return text;
    };
    const self = createSelfIdentity(4242, read);
    expect(self()).toBeNull();
    text = 'garbage';
    expect(self()).toBeNull();
    text = stat('node', '9');
    expect(self()).toEqual({ pid: 4242, procStart: '9' });
  });
});

describe('sameProcess', () => {
  it('matches only the same pid with the same start', () => {
    const read = () => stat('x', '100');
    expect(sameProcess(31, '100', read)).toBe(true);
    expect(sameProcess(31, '101', read)).toBe(false); // PID reuse
  });
  it('is false when the process is gone, unreadable or the start is malformed', () => {
    const gone = () => {
      throw new Error('ENOENT');
    };
    expect(sameProcess(31, '100', gone)).toBe(false);
    expect(sameProcess(31, '', () => stat('x', '100'))).toBe(false);
    expect(sameProcess(31, '100', () => 'junk')).toBe(false);
  });
});
