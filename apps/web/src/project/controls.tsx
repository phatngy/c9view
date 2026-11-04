import { useEffect, useRef, useState } from 'react';
import { SegmentedControl, Select } from '../kit/index.js';
import { sortOptions } from './sessions.js';
export function SessionControls({
  view,
  filter,
  sort,
  onChange,
}: {
  view: string;
  filter: string;
  sort: string;
  onChange: (change: { view?: string; filter?: string; sort?: string }) => void;
}) {
  const [draft, setDraft] = useState(filter);
  const previousFilter = useRef(filter);
  const lastCommitted = useRef(filter);
  const draftRef = useRef(filter);
  const filterRef = useRef(filter);
  const onChangeRef = useRef(onChange);
  const localFilter = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitFilter = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const value = draftRef.current;
    if (value !== filterRef.current) {
      lastCommitted.current = value;
      onChangeRef.current({ filter: value });
    }
  };
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    filterRef.current = filter;
    if (previousFilter.current !== filter) {
      previousFilter.current = filter;
      if (filter !== lastCommitted.current) {
        draftRef.current = filter;
        setDraft(filter);
      }
    }
  }, [filter]);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (localFilter !== filter) {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        if (draftRef.current !== filterRef.current) {
          lastCommitted.current = draftRef.current;
          onChangeRef.current({ filter: draftRef.current });
        }
      }, 250);
    }
  }, [filter, localFilter]);
  useEffect(
    () => () => {
      if (timer.current !== undefined) commitFilter();
    },
    [],
  );
  return (
    <div className="project-controls">
      <SegmentedControl
        label="Session view"
        value={view}
        options={[
          { value: 'board', label: 'Board' },
          { value: 'list', label: 'List' },
        ]}
        onValueChange={(view) => onChange({ view })}
      />
      <label className="project-filter">
        <span className="sr-only">Filter sessions</span>
        <input
          type="search"
          placeholder="Filter title, branch or model…"
          value={localFilter}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
          }}
          onBlur={commitFilter}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitFilter();
          }}
        />
      </label>
      <Select
        label="Sort sessions"
        options={sortOptions}
        value={sort}
        onValueChange={(sort) => onChange({ sort })}
      />
    </div>
  );
}
