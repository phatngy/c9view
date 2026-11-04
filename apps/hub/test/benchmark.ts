// Emits numeric measurements only. Never serialize response bodies or identifiers.
import { loadConfig } from '@c9view/core';
import type {
  OverviewResponse,
  ProjectsResponse,
  ProjectDetailResponse,
} from '@c9view/api';
import { createApp } from '../src/app.js';

const app = createApp(loadConfig());
const samples: {
  pass: number;
  group: number;
  ms: number;
  status: number;
  bytes: number;
}[] = [];
async function request(
  path: string,
  pass: number,
  group: number,
): Promise<unknown> {
  const start = performance.now();
  const response = await app.request(path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  samples.push({
    pass,
    group,
    ms: performance.now() - start,
    status: response.status,
    bytes: bytes.byteLength,
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
let counts: OverviewResponse['columns'] | undefined;
for (const pass of [0, 1]) {
  await request('/api/health', pass, 0);
  const overview = (await request(
    '/api/overview',
    pass,
    1,
  )) as OverviewResponse;
  counts = overview.columns;
  const projects = (await request(
    '/api/projects',
    pass,
    2,
  )) as ProjectsResponse;
  await request('/api/config', pass, 3);
  for (const project of projects.projects ?? []) {
    const path = `/api/projects/${encodeURIComponent(project.id)}`;
    const detail = (await request(path, pass, 4)) as ProjectDetailResponse;
    for (const session of (detail.sessions ?? []).slice(0, 5))
      await request(
        `${path}/sessions/${encodeURIComponent(session.id)}`,
        pass,
        5,
      );
  }
}
const round = (n: number) => Math.round(n * 100) / 100;
for (const pass of [0, 1])
  for (const group of [0, 1, 2, 3, 4, 5]) {
    const groupSamples = samples.filter(
      (s) => s.pass === pass && s.group === group,
    );
    const times = groupSamples.map((s) => s.ms).sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        pass,
        group,
        count: times.length,
        totalMs: round(times.reduce((a, b) => a + b, 0)),
        medianMs: round(times[Math.floor(times.length / 2)] ?? 0),
        maxMs: round(times.at(-1) ?? 0),
        bytes: groupSamples.reduce((n, s) => n + s.bytes, 0),
        statuses: Object.fromEntries(
          [...new Set(groupSamples.map((s) => s.status))].map((status) => [
            status,
            groupSamples.filter((s) => s.status === status).length,
          ]),
        ),
      }),
    );
  }
console.log(JSON.stringify({ columns: counts }));
