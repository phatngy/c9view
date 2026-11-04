import { useEffect, useState, type ReactNode } from 'react';

export function LoginGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const listener = (event: Event) =>
      setMode((event as CustomEvent<string>).detail);
    window.addEventListener('c9view:login', listener);
    // The login route serves the same shell; discover its mode through a protected API.
    if (window.location.pathname === '/login') {
      void fetch('/api/projects')
        .then(async (response) => {
          if (response.status === 401) {
            const body = (await response.json()) as { auth?: string };
            setMode(body.auth === 'password' ? 'password' : 'token');
          } else if (response.ok) window.location.replace('/');
        })
        .catch(() => setError('Unable to connect. Reload to try again.'));
    }
    return () => window.removeEventListener('c9view:login', listener);
  }, []);
  if (!mode && window.location.pathname !== '/login') return children;
  return (
    <main className="page">
      <h1>Log in to c9view</h1>
      {mode === 'password' || mode === 'token' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            void fetch(
              mode === 'token'
                ? `/login?token=${encodeURIComponent(password)}`
                : '/api/login',
              mode === 'token'
                ? {}
                : {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                  },
            )
              .then((response) => {
                if (response.ok) window.location.replace('/');
                else
                  setError(
                    response.status === 429
                      ? `Too many attempts. Try again in ${response.headers.get('Retry-After') ?? '60'} seconds.`
                      : 'Login failed.',
                  );
              })
              .catch(() => setError('Unable to connect.'));
          }}
        >
          <label>
            {mode === 'token' ? 'Token' : 'Password'}{' '}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit">Log in</button>
        </form>
      ) : (
        <p>Connecting…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
