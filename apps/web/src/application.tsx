import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { LiveProvider } from './live/index.js';
import { LoginGate } from './login.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

export function Application() {
  return (
    <LoginGate>
      <QueryClientProvider client={queryClient}>
        <LiveProvider>
          <RouterProvider router={router} />
        </LiveProvider>
      </QueryClientProvider>
    </LoginGate>
  );
}
