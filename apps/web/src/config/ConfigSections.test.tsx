import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalConfigResponse, ProjectDetailResponse } from '@c9view/api';
import { ConfigSections } from '../config.js';
import { Markdown } from '../markdown.js';

const config: GlobalConfigResponse = {
  skills: [
    {
      name: 'Deploy',
      scope: 'user',
      description: 'Publish the release safely',
      path: '/skills/release.md',
    },
  ],
  agents: [
    {
      name: 'Reviewer',
      scope: 'plugin',
      description: 'Release reviewer',
      path: '/agents/check.md',
    },
  ],
  commands: [],
  hooks: [
    { event: 'Stop', matcher: 'Release', command: 'echo done', scope: 'user' },
  ],
  mcpServers: [{ name: 'Docs', scope: 'user', transport: 'stdio' }],
  instructions: [
    {
      path: '/instructions/CLAUDE.md',
      content: '# Release instructions\n\n## Details',
    },
  ],
  plugins: [
    {
      id: 'release-tools',
      enabled: true,
      version: '1',
      skills: 1,
      agents: 1,
      commands: 0,
    },
  ],
  settings: { releaseMode: true },
  provenance: { '/releaseMode': 'user' },
};

const originalScrollingElementDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'scrollingElement',
);
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  document.documentElement,
  'scrollHeight',
);

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

afterEach(() => {
  cleanup();
  restoreDescriptor(
    document,
    'scrollingElement',
    originalScrollingElementDescriptor,
  );
  restoreDescriptor(
    document.documentElement,
    'scrollHeight',
    originalScrollHeightDescriptor,
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function section(name: string) {
  return screen.getByRole('region', { name });
}

describe('Config sections', () => {
  it('tracks sections with IntersectionObserver and suppresses updates after navigation clicks', () => {
    vi.useFakeTimers();
    vi.stubGlobal('innerHeight', 768);
    vi.stubGlobal('scrollY', 0);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: document.documentElement,
    });

    class StubIntersectionObserver implements IntersectionObserver {
      static instances: StubIntersectionObserver[] = [];
      readonly root = null;
      readonly rootMargin = '0px';
      readonly scrollMargin = '0px';
      readonly thresholds = [0];
      readonly observed: Element[] = [];
      readonly disconnect = vi.fn();
      readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        StubIntersectionObserver.instances.push(this);
      }

      observe(target: Element) {
        this.observed.push(target);
      }

      unobserve() {}

      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { unmount } = render(<ConfigSections config={config} />);
    const observer = StubIntersectionObserver.instances[0]!;
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-config-section]'),
    );
    expect(observer.observed).toEqual(sections);

    const nav = screen.getByRole('navigation', {
      name: 'Configuration sections',
    });
    const link = (name: string) => within(nav).getByRole('link', { name });
    const notify = (section: HTMLElement) => {
      act(() => {
        observer.callback(
          [
            {
              isIntersecting: true,
              intersectionRatio: 1,
              target: section,
            } as unknown as IntersectionObserverEntry,
          ],
          observer as IntersectionObserver,
        );
      });
    };

    notify(sections[1]!);
    expect(link('Agents 1')).toHaveAttribute('aria-current', 'location');

    fireEvent.click(link('Hooks 1'));
    expect(link('Hooks 1')).toHaveAttribute('aria-current', 'location');
    notify(sections[0]!);
    expect(link('Hooks 1')).toHaveAttribute('aria-current', 'location');

    act(() => vi.advanceTimersByTime(400));
    fireEvent.click(link('Agents 1'));
    expect(link('Agents 1')).toHaveAttribute('aria-current', 'location');
    act(() => vi.advanceTimersByTime(200));
    notify(sections[0]!);
    expect(link('Agents 1')).toHaveAttribute('aria-current', 'location');

    act(() => vi.advanceTimersByTime(400));
    notify(sections[0]!);
    expect(link('Skills 1')).toHaveAttribute('aria-current', 'location');

    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('clears the resume timer on unmount without IntersectionObserver', () => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', undefined);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    const { unmount } = render(<ConfigSections config={config} />);
    fireEvent.click(screen.getByRole('link', { name: 'Hooks 1' }));
    const resumeTimerIndex = setTimeoutSpy.mock.calls.findLastIndex(
      ([, delay]) => delay === 600,
    );
    expect(resumeTimerIndex).toBeGreaterThanOrEqual(0);
    const resumeTimer = setTimeoutSpy.mock.results[resumeTimerIndex]!.value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(resumeTimer);
  });

  it('keeps the clicked section current when navigating at the page end', () => {
    vi.useFakeTimers();
    vi.stubGlobal('innerHeight', 768);
    vi.stubGlobal('scrollY', 1232);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: document.documentElement,
    });
    class StubIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      readonly scrollMargin = '0px';
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    render(<ConfigSections config={config} />);
    const hooks = screen.getByRole('link', { name: 'Hooks 1' });
    fireEvent.click(hooks);
    expect(hooks).toHaveAttribute('aria-current', 'location');

    act(() => vi.advanceTimersByTime(600));

    expect(hooks).toHaveAttribute('aria-current', 'location');
  });

  it('marks the last section current when the page is scrolled to its end', () => {
    vi.stubGlobal('innerHeight', 768);
    vi.stubGlobal('scrollY', 1232);
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: document.documentElement,
    });
    class StubIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      readonly scrollMargin = '0px';
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    render(<ConfigSections config={config} />);
    fireEvent.scroll(window);
    expect(screen.getByRole('link', { name: 'Settings 1' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('shows section counts and moves focus with section navigation', () => {
    render(<ConfigSections config={config} />);
    const nav = screen.getByRole('navigation', {
      name: 'Configuration sections',
    });
    for (const name of [
      'Skills',
      'Agents',
      'Hooks',
      'MCP',
      'Instructions',
      'Plugins',
      'Settings',
    ]) {
      expect(
        within(nav).getByRole('link', { name: `${name} 1` }),
      ).toBeInTheDocument();
    }
    expect(
      within(nav).getByRole('link', { name: 'Memory 0' }),
    ).toBeInTheDocument();
    const hooks = within(nav).getByRole('link', { name: 'Hooks 1' });
    const heading = within(section('Hooks')).getByRole('heading', {
      name: 'Hooks',
    });
    const focus = vi.spyOn(heading, 'focus');
    fireEvent.click(hooks);
    // Focusing must not cancel the smooth scroll the click started.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hooks).toHaveAttribute('aria-current', 'location');
    expect(document.activeElement).toBe(
      within(section('Hooks')).getByRole('heading', { name: 'Hooks' }),
    );
    expect(
      within(nav).getByRole('link', { name: 'Skills 1' }),
    ).not.toHaveAttribute('aria-current');
    expect(window.location.hash).toBe('');
  });

  it('filters names and descriptions across every section and updates counts', () => {
    render(<ConfigSections config={config} />);
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Filter configuration' }),
      { target: { value: 'rElEaSe' } },
    );
    const nav = screen.getByRole('navigation');
    for (const name of [
      'Skills',
      'Agents',
      'Hooks',
      'Instructions',
      'Plugins',
      'Settings',
    ]) {
      expect(
        within(nav).getByRole('link', { name: `${name} 1` }),
      ).toBeInTheDocument();
    }
    expect(
      within(nav).getByRole('link', { name: 'MCP 0' }),
    ).toBeInTheDocument();
    expect(within(section('MCP')).getByText('No matches')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(
      within(nav).getByRole('link', { name: 'MCP 1' }),
    ).toBeInTheDocument();
  });

  it('matches paths case-insensitively and discloses the full description and path', () => {
    render(<ConfigSections config={config} />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '/SKILLS/' },
    });
    expect(screen.getByRole('link', { name: 'Skills 1' })).toBeInTheDocument();
    expect(screen.queryByText('/skills/release.md')).not.toBeVisible();
    const toggle = screen.getByRole('button', { name: 'More about Deploy' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('More');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'More about Deploy');
    expect(toggle).toHaveTextContent('Less');
    expect(screen.getByText('/skills/release.md')).toBeVisible();
    expect(screen.getByText('Publish the release safely')).toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByText('/skills/release.md')).not.toBeVisible();
  });

  it('keeps one page h1 and demotes all instruction and memory Markdown headings', () => {
    const projectConfig: ProjectDetailResponse['config'] = {
      ...config,
      memory: [
        {
          name: 'Release memory',
          description: 'Release notes',
          type: 'project',
          body: '# Memory title\n\n## Memory details',
        },
      ],
    };
    render(
      <>
        <h1>Config</h1>
        <ConfigSections config={projectConfig} />
      </>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'More about CLAUDE.md' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'More about Release memory' }),
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Release instructions' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Memory details' }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'release notes' },
    });
    expect(screen.getByRole('link', { name: 'Memory 1' })).toBeInTheDocument();
  });

  it('preserves default Markdown heading levels for other callers', () => {
    render(<Markdown text="# Original heading" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Original heading' }),
    ).toBeInTheDocument();
  });

  it('does not render Markdown content while an instruction row is collapsed', () => {
    render(<ConfigSections config={config} />);
    expect(screen.queryByText('Release instructions')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'More about CLAUDE.md' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Release instructions' }),
    ).toBeInTheDocument();
  });

  it('shows zero counts and an empty state in every section when nothing matches', () => {
    render(<ConfigSections config={config} />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-such-config-entry' },
    });
    const nav = screen.getByRole('navigation', {
      name: 'Configuration sections',
    });
    for (const name of [
      'Skills',
      'Agents',
      'Commands',
      'Hooks',
      'MCP',
      'Instructions',
      'Memory',
      'Plugins',
      'Settings',
    ]) {
      expect(
        within(nav).getByRole('link', { name: `${name} 0` }),
      ).toBeInTheDocument();
      expect(within(section(name)).getByText('No matches')).toBeInTheDocument();
    }
  });

  it('shows Plugins as an empty section for project configuration', () => {
    const projectConfig: ProjectDetailResponse['config'] = {
      skills: [],
      agents: [],
      commands: [],
      hooks: [],
      mcpServers: [],
      instructions: [],
      memory: [],
      settings: {},
    };
    render(<ConfigSections config={projectConfig} />);
    expect(screen.getByRole('link', { name: 'Plugins 0' })).toBeInTheDocument();
    expect(
      within(section('Plugins')).getByText('No plugins installed.'),
    ).toBeInTheDocument();
  });

  it('describes hooks without a matcher or command', () => {
    const hookConfig: GlobalConfigResponse = {
      ...config,
      hooks: [{ event: 'Stop', matcher: null, command: '', scope: 'user' }],
    };
    render(<ConfigSections config={hookConfig} />);
    expect(screen.getAllByText('No command.')[0]).toBeVisible();
  });
});
