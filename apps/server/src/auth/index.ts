import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { VERSION } from '@c9view/core';

export type AuthMode = 'none' | 'token' | 'password';
export function authMode(value: string = 'none'): AuthMode {
  const parsed = z.enum(['none', 'token', 'password']).safeParse(value);
  if (!parsed.success)
    throw new Error('C9VIEW_AUTH must be one of: none, token, password');
  return parsed.data;
}
export function validateExposure(
  host: string,
  allowedHosts: string[],
  mode: AuthMode,
  insecure = false,
) {
  if (
    mode === 'none' &&
    (!['127.0.0.1', '::1', 'localhost'].includes(
      normalizeBindHost(host).toLowerCase(),
    ) ||
      allowedHosts.length > 0)
  ) {
    if (!insecure)
      throw new Error(
        'Non-loopback HOST or extra allowed hosts require login. Set C9VIEW_AUTH=token or --auth password.',
      );
    console.warn(
      'WARNING: C9VIEW_INSECURE_NO_AUTH=1 disables login. UNSAFE behind tunnels: anyone with access can read your data.',
    );
  } else if (insecure) {
    console.warn(
      'WARNING: C9VIEW_INSECURE_NO_AUTH=1 is set. Disabling login is UNSAFE behind tunnels.',
    );
  }
}
export function normalizeBindHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}
// Hash first so comparisons always have equal length, including malformed credentials.
function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function createAuth(options: {
  mode: AuthMode;
  token?: string;
  password?: string;
  trustProxy?: boolean;
  now?: () => number;
}) {
  const { mode, trustProxy } = options;
  if (mode === 'password' && !options.password)
    throw new Error('C9VIEW_PASSWORD is required for password auth');
  if (options.token !== undefined && options.token.length < 32)
    throw new Error('C9VIEW_TOKEN must contain at least 32 characters');
  const token =
    mode === 'token'
      ? options.token || randomBytes(32).toString('hex')
      : undefined;
  const key = randomBytes(32);
  const salt = randomBytes(32);
  const passwordHash =
    mode === 'password' ? scryptSync(options.password!, salt, 64) : undefined;
  const sessions = new Map<string, number>();
  const attempts = new Map<
    string,
    { last: number; count: number; until: number }
  >();
  let failures: number[] = [];
  const now = options.now ?? Date.now;
  const lifetime = 24 * 60 * 60 * 1000;
  const sign = (id: string) =>
    createHmac('sha256', key).update(id).digest('hex');
  const middleware: MiddlewareHandler = async (c, next) => {
    if (mode === 'none') return next();
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    let time = now();
    for (const [id, expiry] of sessions)
      if (expiry <= time) sessions.delete(id);
    for (const [ip, entry] of attempts)
      if (time - entry.last >= 5 * 60_000) attempts.delete(ip);
    const cookie = getCookie(c, 'c9view_session') ?? '';
    const [id = '', signature = ''] = cookie.split('.');
    const valid =
      equal(signature, sign(id)) &&
      cookie === `${id}.${signature}` &&
      (sessions.get(id) ?? 0) > time;
    // Only explicitly trusted proxies may supply a client identity.
    let ip = 'unknown';
    try {
      ip = getConnInfo(c).remote.address ?? ip;
    } catch {
      /* In-process requests have no socket. */
    }
    if (trustProxy)
      ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || ip;
    const throttled = () => {
      time = now();
      failures = failures.filter((failure) => time - failure < 60_000);
      const until = attempts.get(ip)?.until ?? 0;
      if (
        until > time ||
        failures.length >= 60 ||
        (!attempts.has(ip) && attempts.size >= 10_000)
      ) {
        const globalUntil =
          failures.length >= 60 ? failures[0]! + 60_000 : time;
        c.header(
          'Retry-After',
          String(
            Math.max(
              1,
              Math.ceil((Math.max(until, globalUntil) - time) / 1000),
            ),
          ),
        );
        return c.json({ error: 'Too many attempts' }, 429);
      }
      return undefined;
    };
    const failure = () => {
      const count = (attempts.get(ip)?.count ?? 0) + 1;
      attempts.set(ip, {
        last: time,
        count,
        until: time + Math.min(60_000, 1000 * 2 ** Math.min(count - 1, 6)),
      });
      failures.push(time);
      return c.json({ error: 'Invalid credentials', auth: mode }, 401);
    };
    const login = () => {
      attempts.delete(ip);
      if (sessions.size >= 10_000)
        sessions.delete(sessions.keys().next().value!);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, time + lifetime);
      setCookie(c, 'c9view_session', `${id}.${sign(id)}`, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: lifetime / 1000,
        secure:
          new URL(c.req.url).protocol === 'https:' ||
          (trustProxy === true &&
            c.req.header('x-forwarded-proto') === 'https'),
      });
    };
    if (c.req.path === '/login' && c.req.method === 'GET') {
      if (c.req.query('token') !== undefined) {
        if (mode === 'token' && equal(c.req.query('token') ?? '', token ?? '')) {
          // Tokens are at least 32 characters (256-bit random by default), so online guessing is infeasible; backoff for tokens only adds a lockout risk.
          login();
          return c.redirect('/');
        }
        const limited = throttled();
        if (limited) return limited;
        return failure();
      }
      return next(); // Only the login SPA shell and its compiled assets are public.
    }
    if (c.req.path === '/api/login' && c.req.method === 'POST') {
      if (mode !== 'password')
        return c.json({ error: 'Invalid credentials', auth: mode }, 401);
      if (
        c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      )
        return c.json({ error: 'Expected application/json' }, 415);
      const limited = throttled();
      if (limited) return limited;
      const body = z
        .object({ password: z.string().max(4096) })
        .safeParse(await c.req.json().catch(() => null));
      // Body reads yield: recheck so concurrent requests cannot bypass the cap.
      const afterBody = throttled();
      if (afterBody) return afterBody;
      const candidate = scryptSync(
        body.success ? body.data.password : '',
        salt,
        64,
      );
      const matches = timingSafeEqual(candidate, passwordHash!);
      if (!matches || !body.success) return failure();
      login();
      return c.json({ ok: true });
    }
    if (valid) return next();
    if (c.req.path === '/api/health' && c.req.method === 'GET')
      return c.json({ ok: true, version: VERSION, auth: 'required' });
    if (
      c.req.method === 'GET' &&
      /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(c.req.path)
    )
      return next();
    if (
      c.req.method === 'GET' &&
      c.req.header('accept')?.includes('text/html') &&
      !c.req.path.startsWith('/api/')
    )
      return c.redirect('/login');
    return c.json({ error: 'Login required', auth: mode }, 401);
  };
  return { middleware, token };
}
