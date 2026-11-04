import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { EmptyState } from './kit/index.js';
import { ConfigRow } from './config/ConfigRow.js';
import { configSections, type Config } from './config/sections.js';

const NAV_CLICK_SUPPRESSION_MS = 600;

export function ConfigSections({ config }: { config: Config }) {
  const [filter, setFilter] = useState('');
  const [current, setCurrent] = useState('skills');
  const observerSuppressed = useRef(false);
  const resumeObserverTimer = useRef<number | undefined>(undefined);
  const prefix = useId();
  const searchId = `${prefix}-filter`;
  const needle = filter.trim().toLocaleLowerCase();
  const sections = useMemo(() => configSections(config), [config]);
  const filteredSections = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        rows: section.rows.filter((row) =>
          [row.name, row.description, row.path ?? ''].some((text) =>
            text.toLocaleLowerCase().includes(needle),
          ),
        ),
      })),
    [sections, needle],
  );

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionElements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-config-section]'),
    );
    const lastSectionId = sectionElements.at(-1)?.dataset.sectionId;
    const scrollContainer = getConfigScrollContainer(sectionElements);
    const isAtBottom = () => isScrollContainerAtBottom(scrollContainer);
    const updateAtBottom = () => {
      if (!observerSuppressed.current && isAtBottom() && lastSectionId) {
        setCurrent(lastSectionId);
      }
    };
    const scrollTarget: Window | Element =
      !scrollContainer || scrollContainer === document.scrollingElement
        ? window
        : scrollContainer;
    scrollTarget.addEventListener('scroll', updateAtBottom, { passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        if (observerSuppressed.current) return;
        if (isAtBottom() && lastSectionId) {
          setCurrent(lastSectionId);
          return;
        }
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.getAttribute('data-section-id');
        if (id) setCurrent(id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    sectionElements.forEach((section) => observer.observe(section));
    return () => {
      window.clearTimeout(resumeObserverTimer.current);
      scrollTarget.removeEventListener('scroll', updateAtBottom);
      observer.disconnect();
    };
  }, [prefix]);

  useEffect(
    () => () => window.clearTimeout(resumeObserverTimer.current),
    [],
  );

  function navigateToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    observerSuppressed.current = true;
    window.clearTimeout(resumeObserverTimer.current);
    resumeObserverTimer.current = window.setTimeout(() => {
      observerSuppressed.current = false;
    }, NAV_CLICK_SUPPRESSION_MS);
    const section = document.getElementById(`${prefix}-${id}`);
    if (!section) return;
    const heading = section.querySelector<HTMLElement>('h2');
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    section.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth' });
    heading?.focus({ preventScroll: true });
    setCurrent(id);
  }
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="text-sm font-medium">
          Filter configuration
        </label>
        <input
          id={searchId}
          type="search"
          className="min-h-11 w-full lg:min-h-9"
          placeholder="Name, description or path"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <nav
          aria-label="Configuration sections"
          className="min-w-0 lg:sticky lg:top-4 lg:self-start"
        >
          <div className="flex gap-2 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
            {filteredSections.map((section) => (
              <a
                key={section.id}
                href={`#${prefix}-${section.id}`}
                aria-current={current === section.id ? 'location' : undefined}
                onClick={(event) => navigateToSection(event, section.id)}
                className={`flex min-h-11 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-md border px-3 text-xs lg:min-h-9 ${current === section.id ? 'border-ink bg-surface font-semibold text-ink' : 'border-line text-muted hover:bg-surface'}`}
              >
                <span>{section.title}</span>{' '}
                <span className="tabular-nums">{section.rows.length}</span>
              </a>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
          {filteredSections.map((section) => (
            <section
              key={section.id}
              id={`${prefix}-${section.id}`}
              data-config-section
              data-section-id={section.id}
              aria-labelledby={`${prefix}-${section.id}-title`}
              className="panel scroll-mt-4"
            >
              <h2 id={`${prefix}-${section.id}-title`} tabIndex={-1}>
                {section.title}
              </h2>
              {section.rows.length ? (
                <div className="divide-y divide-line">
                  {section.rows.map((row, index) => (
                    <ConfigRow
                      key={`${row.name}-${row.path ?? ''}-${index}`}
                      row={row}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title={
                    needle
                      ? 'No matches'
                      : section.id === 'plugins'
                        ? 'No plugins installed.'
                        : `No ${section.title.toLowerCase()} configured.`
                  }
                />
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function getConfigScrollContainer(
  sections: NodeListOf<HTMLElement> | HTMLElement[],
): Element | null {
  const firstSection = sections[0];
  for (
    let parent = firstSection?.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
  }
  return document.scrollingElement;
}

function isScrollContainerAtBottom(container: Element | null): boolean {
  if (!container) return false;
  if (container === document.scrollingElement) {
    const pageHeight = document.documentElement.scrollHeight;
    return (
      pageHeight > 0 && window.scrollY + window.innerHeight >= pageHeight - 1
    );
  }
  return (
    container.scrollHeight > 0 &&
    container.scrollTop + container.clientHeight >= container.scrollHeight - 1
  );
}
