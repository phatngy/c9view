import { z } from 'zod';

export function isControlMutation(method: string, path: string): boolean {
  return (
    method === 'POST' &&
    (path === '/api' || path.startsWith('/api/')) &&
    path !== '/api/login' &&
    path !== '/api/logout'
  );
}

export function guardControl(
  request: Request,
  allowedHosts: ReadonlySet<string>,
  authenticated: boolean,
): string | Response {
  const forbidden = () =>
    Response.json({ error: 'Forbidden' }, { status: 403 });
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
    'application/json'
  )
    return forbidden();
  const origin = request.headers.get('origin');
  if (!origin) return forbidden();
  try {
    const url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !allowedHosts.has(url.hostname.toLowerCase())
    )
      return forbidden();
  } catch {
    return forbidden();
  }
  if (request.headers.get('x-c9view-control') !== '1') return forbidden();
  if (!authenticated) return forbidden();
  const bootId = z
    .string()
    .uuid()
    .safeParse(request.headers.get('x-c9view-boot-id'));
  return bootId.success ? bootId.data : forbidden();
}
