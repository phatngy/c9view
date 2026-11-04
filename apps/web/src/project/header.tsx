import type { ProjectSummary } from '@c9view/api';
import { money, number, total } from '../ui.js';

export function ProjectHeader({ project }: { project: ProjectSummary }) {
  return (
    <header className="project-header">
      <div className="min-w-0">
        <p className="eyebrow">PROJECT</p>
        <h1>{project.name}</h1>
        <p className="mt-2 break-all font-mono text-small text-muted">
          {project.path}
        </p>
      </div>
      <dl className="project-totals" aria-label="All-time project totals">
        <div>
          <dt>Sessions</dt>
          <dd>{number(project.sessionCount)}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{number(total(project.tokens))}</dd>
        </div>
        <div>
          <dt>
            <a href="#api-equivalent-cost">≈ API-equivalent cost</a>
          </dt>
          <dd>≈ {money(project.costUsd)}</dd>
        </div>
      </dl>
    </header>
  );
}
