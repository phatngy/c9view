import { expect, it } from 'vitest';
import { parseGitUrl } from './url.js';

const rejected = [
  'https://host/o/r.git extra',
  'https://host/o/r.git\n',
  'https://host/o/\u0007r.git',
  'ssh://-oProxyCommand=x/y',
  '-oProxyCommand=x@host:p',
  'user@-host:p',
  'us er@host:p',
  'us$er@host:p',
  'user@ho$t:p',
  'x:y',
  './x:y',
  '/x:y',
  'C:\\x',
  'fd::x',
  'file:///tmp/x',
  'ext::sh -c x',
  'ext::x',
  'git://host/o/r.git',
  'http://host/o/r.git',
  'https://user:secret@host/o/r.git',
  'https://-host/o/r.git',
  'https://ho_st/o/r.git',
  'https://host',
  'ssh://-u@host/o/r',
  'ssh://u%2Fv@host/o/r',
  '',
];
it.each(rejected)('T093 rejects %j with bad-url', (value) => {
  expect(() => parseGitUrl(value)).toThrowError(
    expect.objectContaining({ status: 400, reason: 'bad-url' }),
  );
});
it('T093 accepts https, ssh, scp-like and bracketed IPv6 and returns the parsed URL', () => {
  expect(parseGitUrl('https://host.example/o/r.git')).toBe(
    'https://host.example/o/r.git',
  );
  expect(parseGitUrl('ssh://git@host.example:22/o/r.git')).toBe(
    'ssh://git@host.example:22/o/r.git',
  );
  expect(parseGitUrl('git@host.example:o/r.git')).toBe(
    'git@host.example:o/r.git',
  );
  expect(parseGitUrl('git@[::1]:o/r.git')).toBe('git@[::1]:o/r.git');
  expect(parseGitUrl('ssh://git@[2001:db8::1]/o/r.git')).toBe(
    'ssh://git@[2001:db8::1]/o/r.git',
  );
  expect(parseGitUrl('HTTPS://Host.Example/o/r.git')).toBe(
    'https://host.example/o/r.git',
  );
});
