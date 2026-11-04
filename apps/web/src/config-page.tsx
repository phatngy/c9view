import { useBreadcrumbs } from './shell/breadcrumbs.js';
import { useConfig } from './api.js';
import { ConfigSections } from './config.js';
import { Failure, Loading } from './ui.js';

export function ConfigPage() {
  useBreadcrumbs([{ label: 'Config' }]);
  const query = useConfig();
  if (query.error) return <Failure error={query.error} retry={query.refetch} />;
  if (!query.data) return <Loading />;
  return (
    <div className="config-page mx-auto min-w-0 max-w-5xl space-y-5">
      <header>
        <p className="text-xs font-medium text-muted">
          CLAUDE CODE
        </p>
        <h1>Global config</h1>
        <p className="mt-2 text-muted">
          User configuration and installed extensions.
        </p>
      </header>
      <ConfigSections config={query.data} />
    </div>
  );
}
