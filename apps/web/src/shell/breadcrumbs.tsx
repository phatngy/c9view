import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useParams } from '@tanstack/react-router';
import { useProjects } from '../api.js';
import { formatProjectNameHint, projectNameHints } from '../projectNames.js';
import { ProjectName } from './ProjectName.js';

export interface Breadcrumb {
  label: ReactNode;
  to?: string;
  /** Plain name for navigation controls when the visible label contains markup. */
  textLabel?: string;
}
const BreadcrumbContext = createContext<{
  items: Breadcrumb[];
  setItems: (items: Breadcrumb[]) => void;
} | null>(null);
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Breadcrumb[]>([]);
  return (
    <BreadcrumbContext.Provider value={{ items, setItems }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}
export function useBreadcrumbs(items: Breadcrumb[]) {
  const setItems = useContext(BreadcrumbContext)?.setItems;
  const itemsKey = items
    .map(
      (item) =>
        `${typeof item.label === 'string' ? item.label : ''}\u0000${item.to ?? ''}`,
    )
    .join('\u0001');
  const params = useParams({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const projects = useProjects();
  const projectId = params.projectId;
  const hint = useMemo(() => {
    if (!projectId) return undefined;
    const parts = projectNameHints(projects.data?.projects ?? []).get(
      projectId,
    );
    return parts ? formatProjectNameHint(parts) : undefined;
  }, [projectId, projects.data?.projects]);
  const resolved = useMemo(() => {
    // These workspace routes have Overview as their parent, regardless of labels.
    const trail =
      items.length === 1 && ['/search', '/config'].includes(pathname)
        ? [{ label: 'Overview', to: '/' }, ...items]
        : items;
    if (!projectId || trail.length < 2) return trail;
    const nameHint = projectNameHints(projects.data?.projects ?? []).get(
      projectId,
    );
    return trail.map((item, index) =>
      index === 1
        ? {
            ...item,
            textLabel: typeof item.label === 'string' ? item.label : projectId,
            label: (
              <ProjectName name={item.label} id={projectId} hint={nameHint} />
            ),
          }
        : item,
    );
  }, [items, pathname, projectId, projects.data?.projects]);
  const registrationKey = `${itemsKey}\u0002${pathname}\u0002${projectId ?? ''}\u0002${hint ?? ''}`;
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);
  useEffect(() => {
    setItems?.(resolvedRef.current);
    return () => setItems?.([]);
  }, [registrationKey, setItems]);
}
export function useShellBreadcrumbs() {
  return useContext(BreadcrumbContext)?.items ?? [];
}
