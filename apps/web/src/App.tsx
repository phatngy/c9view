import { Outlet, useParams } from '@tanstack/react-router';
import { AppShell } from './shell/AppShell.js';
import { MachineContext } from './machine.js';
export function App() {
  const { machineId = 'local' } = useParams({ strict: false });
  return (
    <MachineContext.Provider value={machineId}>
      <AppShell>
        <Outlet />
      </AppShell>
    </MachineContext.Provider>
  );
}
