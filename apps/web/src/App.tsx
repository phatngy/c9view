import { Outlet } from '@tanstack/react-router';
import { AppShell } from './shell/AppShell.js';
export function App() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
