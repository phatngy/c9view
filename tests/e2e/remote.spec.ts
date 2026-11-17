// Remote send to a fake terminal session (003). Every case spawns its own fake
// (a separate process with its own PID, see fake-terminal.ts) through the
// controller in control-server.ts; no Claude runs. The desktop and phone
// projects both run this file, so session names carry the project name.
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  controlBaseURL,
  controlSessionPathFor,
  controlToken,
  terminalControllerURL,
  terminalToken,
} from './control-fixture.js';

const SEND = 'Send to the terminal session';
const sentText = 'Sent. Waiting for the session to pick it up…';
const newTurn = 'Delivered: Claude is starting a new turn.';
const nextStep = 'Delivered: Claude sees it at its next step.';
const API = '/api/m/local';
const PROJECT_API = `${API}/projects/-synthetic-control`;

test.beforeEach(async ({ page }) => {
  await page.goto(`/login?token=${controlToken}`);
  await expect(page).toHaveURL(/\/m\/local$/);
});

interface Terminal {
  sessionId: string;
  port: number;
  pid: number;
  state(): Promise<{
    frames: { msgId: string; body: string }[];
    held: number;
  }>;
  post(path: string, data?: object): Promise<void>;
}
interface Options {
  live?: Record<string, unknown>;
  permissionMode?: string | null;
  unverified?: boolean;
}
async function startTerminal(
  name: string,
  options: Options = {},
  sessionId = `t-${name}-${suffix()}`,
): Promise<Terminal> {
  const api = await playwrightRequest.newContext({
    extraHTTPHeaders: { 'x-e2e-terminal-token': terminalToken() },
  });
  const response = await api.post(`${terminalControllerURL}/terminals`, {
    data: { sessionId, ...options },
  });
  expect(response.ok()).toBe(true);
  const { port, pid } = (await response.json()) as {
    port: number;
    pid: number;
  };
  const base = `http://127.0.0.1:${port}`;
  const terminal: Terminal = {
    sessionId,
    port,
    pid,
    state: async () => (await api.get(`${base}/state`)).json(),
    post: async (path, data = {}) => {
      await api.post(`${base}${path}`, { data });
    },
  };
  return terminal;
}
async function open(page: Page, terminal: Terminal) {
  // The node indexes the fake's transcript like any other session.
  await expect
    .poll(
      async () =>
        (
          await page.request.get(
            `${PROJECT_API}/sessions/${terminal.sessionId}`,
          )
        ).status(),
      { timeout: 15_000 },
    )
    .toBe(200);
  await page.goto(controlSessionPathFor(terminal.sessionId));
}
const composer = (page: Page) =>
  page.getByRole('textbox', { name: 'Reply to session' });
const sendButton = (page: Page) => page.getByRole('button', { name: SEND });
const outcomes = (page: Page) => page.locator('#remote-notice');
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await sendButton(page).click();
}
// This terminal's session appears once; the page started no other session of its own.
async function sessionIds(page: Page, name: string) {
  const body = (await (await page.request.get(PROJECT_API)).json()) as {
    sessions: { id: string }[];
  };
  return body.sessions.map((session) => session.id).filter((id) => id === name);
}
async function bootId(page: Page) {
  const machines = (await (await page.request.get('/api/machines')).json()) as {
    bootId: string;
  }[];
  return machines[0]!.bootId;
}
async function guardedPost(
  page: Page,
  terminal: Terminal,
  id: string,
  text: string,
) {
  return page.request.post(
    `${PROJECT_API}/sessions/${terminal.sessionId}/remote`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-C9view-Control': '1',
        'X-C9view-Boot-Id': await bootId(page),
        Origin: controlBaseURL,
      },
      data: { text, clientRequestId: id },
    },
  );
}
const suffix = () => (isPhone() ? 'p' : 'd');
const isPhone = () => test.info().project.name.endsWith('phone');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test('Send goes into the same session once, with no new session and no fork', async ({
  page,
}) => {
  const terminal = await startTerminal('send');
  await open(page, terminal);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST')
      posts.push(new URL(request.url()).pathname);
  });
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
  await expect(sendButton(page)).toBeVisible();
  await expect(
    page.getByText(
      'This session is open in a terminal. Your message goes into it as a message from another session.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/fork/i)).toHaveCount(0);
  await send(page, 'Hello from the web');
  await expect(outcomes(page).getByText(sentText)).toBeVisible({
    timeout: 2000,
  });
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 2000,
  });
  await expect(composer(page)).toHaveValue('');
  // The same session grows without a reload.
  await expect(
    page.getByText('Synthetic terminal reply to: Hello from the web'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
  const state = await terminal.state();
  expect(state.frames).toHaveLength(1);
  // Attribution in the frame the terminal received.
  expect(state.frames[0]!.body).toMatch(
    /^Sent by this session's owner from c9view\.\n\nHello from the web$/,
  );
  // One POST, to the remote route: no reply, no new session, no fork.
  expect(posts).toEqual([
    `${PROJECT_API}/sessions/${terminal.sessionId}/remote`,
  ]);
  expect(await sessionIds(page, terminal.sessionId)).toEqual([
    terminal.sessionId,
  ]);
  // The terminal process is untouched.
  expect(() => process.kill(terminal.pid, 0)).not.toThrow();
});

test('A retried command reaches the terminal once; a changed body is refused', async ({
  page,
}) => {
  const terminal = await startTerminal('retry');
  await open(page, terminal);
  const id = crypto.randomUUID();
  const first = await guardedPost(page, terminal, id, 'Retry me');
  expect(first.status()).toBe(202);
  const again = await guardedPost(page, terminal, id, 'Retry me');
  expect(again.status()).toBe(202);
  expect(await again.json()).toMatchObject({ clientRequestId: id });
  const changed = await guardedPost(page, terminal, id, 'Different text');
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toMatchObject({ reason: 'payload-mismatch' });
  await expect.poll(async () => (await terminal.state()).frames.length).toBe(1);
  await page.waitForTimeout(500);
  expect((await terminal.state()).frames).toHaveLength(1);
});

test('A lost response is recovered from the receipt without sending twice', async ({
  page,
}) => {
  const terminal = await startTerminal('lost');
  await open(page, terminal);
  let dropped = false;
  await page.route('**/remote', async (route) => {
    if (route.request().method() !== 'POST' || dropped) return route.continue();
    dropped = true;
    // The node gets and answers the command; the browser never sees it.
    await route.fetch();
    await route.abort('connectionreset');
  });
  await send(page, 'Lost response');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 8000,
  });
  expect((await terminal.state()).frames).toHaveLength(1);
});

test('Control off: no remote route and no composer', async ({
  playwright,
  browser,
}) => {
  // The plain e2e server (port 7791) runs with control off.
  const api = await playwright.request.newContext({
    baseURL: 'http://127.0.0.1:7791',
  });
  const path =
    '/api/m/local/projects/-synthetic-alpha/sessions/session-one/remote';
  expect((await api.get(path)).status()).toBe(404);
  const machines = (await (await api.get('/api/machines')).json()) as {
    bootId: string;
  }[];
  const post = await api.post(path, {
    headers: {
      'Content-Type': 'application/json',
      'X-C9view-Control': '1',
      'X-C9view-Boot-Id': machines[0]!.bootId,
      Origin: 'http://127.0.0.1:7791',
    },
    data: { text: 'x', clientRequestId: crypto.randomUUID() },
  });
  // The hub's guard refuses a control POST without login first (403); either way nothing is accepted.
  expect([403, 404]).toContain(post.status());
  await api.dispose();
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:7791',
  });
  const page = await context.newPage();
  await page.goto('/m/local/projects/-synthetic-alpha/sessions/session-one');
  await expect(page.getByLabel('Conversation messages')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Reply to session' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: SEND })).toHaveCount(0);
  await context.close();
});

test('A mid-turn session records it for its next step', async ({ page }) => {
  const terminal = await startTerminal('busy');
  await terminal.post('/behavior', { behavior: 'queued' });
  await open(page, terminal);
  await send(page, 'While you work');
  await expect(outcomes(page).getByText(nextStep)).toBeVisible({
    timeout: 4000,
  });
});

test('A held message is not seen yet, then delivered when let in', async ({
  page,
}) => {
  const terminal = await startTerminal('hold');
  await terminal.post('/behavior', { behavior: 'hold' });
  await open(page, terminal);
  await send(page, 'Held at the terminal');
  await expect(outcomes(page).getByText(sentText)).toBeVisible({
    timeout: 2000,
  });
  await expect(
    outcomes(page).getByText(
      'Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages.',
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(outcomes(page).getByText(/^Delivered/)).toHaveCount(0);
  await terminal.post('/release');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 6000,
  });
  expect((await terminal.state()).frames).toHaveLength(1);
});

test('A write that may be partial is uncertain, tracked, then delivered, never re-sent', async ({
  page,
}) => {
  // A Unix socket cannot be made to fail mid-frame honestly, so the node's
  // answer is rewritten to the "uncertain" receipt (unit tests cover the node
  // side); the frame really was written, so the receipt then becomes delivered.
  const terminal = await startTerminal('uncertain');
  await open(page, terminal);
  await page.route('**/remote', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const receipt = await response.json();
    await route.fulfill({
      response,
      json: { ...receipt, delivery: { state: 'uncertain' } },
    });
  });
  await send(page, 'Maybe cut off');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 6000,
  });
  expect((await terminal.state()).frames).toHaveLength(1);
});

test('A dead listener fails as unreachable and keeps the text', async ({
  page,
}) => {
  const terminal = await startTerminal('dead');
  await open(page, terminal);
  await expect(sendButton(page)).toBeVisible();
  await terminal.post('/stop-listening');
  await send(page, 'Nobody home');
  await expect(
    outcomes(page).getByText("Not delivered: the session couldn't be reached."),
  ).toBeVisible({ timeout: 4000 });
  await expect(composer(page)).toHaveValue('Nobody home');
});

test('Two tabs: both messages arrive once in order and both outcomes show in each tab', async ({
  page,
  context,
}) => {
  const terminal = await startTerminal('tabs');
  await open(page, terminal);
  const other = await context.newPage();
  await other.goto(controlSessionPathFor(terminal.sessionId));
  await expect(sendButton(other)).toBeVisible();
  await send(page, 'From tab one');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 4000,
  });
  await send(other, 'From tab two');
  await expect(outcomes(other).getByText(newTurn)).toBeVisible({
    timeout: 4000,
  });
  // Each tab learns of the other's command from its hint and receipt.
  await expect(outcomes(page).getByText(newTurn)).toHaveCount(2, {
    timeout: 6000,
  });
  await expect(outcomes(other).getByText(newTurn)).toHaveCount(2, {
    timeout: 6000,
  });
  expect((await terminal.state()).frames.map((frame) => frame.body)).toEqual([
    expect.stringContaining('From tab one'),
    expect.stringContaining('From tab two'),
  ]);
});

const refusals: [string, Options, string, string | undefined][] = [
  [
    'too old',
    { live: { version: '2.1.100' } },
    'Update Claude Code to 2.1.318 or newer.',
    'Restart the session in the terminal after updating.',
  ],
  [
    'no address',
    { live: { messagingSocketPath: null } },
    "This session can't be reached: it has no messaging address.",
    'Update Claude Code, or turn on cross-session messaging in that session.',
  ],
  [
    'unknown protocol',
    { live: { peerProtocol: 2 } },
    "This session uses a messaging version c9view doesn't know.",
    'Update c9view.',
  ],
  [
    'not interactive',
    { live: { entrypoint: 'sdk-cli' } },
    'This is not an interactive terminal session. Only those can receive messages.',
    undefined,
  ],
  [
    'process start mismatch',
    { live: { procStart: '1' } },
    "This session's messaging address can't be confirmed as its own.",
    'Restart the session in the terminal.',
  ],
];
for (const [name, options, reason, fix] of refusals)
  test(`Refused: ${name}, with the fix, the text kept and nothing sent`, async ({
    page,
  }) => {
    test.skip(isPhone(), 'Desktop only');
    const terminal = await startTerminal(
      `refuse-${name.replace(/ /g, '-')}`,
      options,
    );
    await open(page, terminal);
    await expect(sendButton(page)).toBeVisible();
    await composer(page).fill('Keep me');
    await expect(outcomes(page)).toContainText(reason);
    if (fix) await expect(outcomes(page)).toContainText(fix);
    await expect(sendButton(page)).toBeDisabled();
    await expect(composer(page)).toHaveValue('Keep me');
    await expect(page.getByText(/fork|send when free|queue/i)).toHaveCount(0);
    expect((await terminal.state()).frames).toHaveLength(0);
  });

test('Refused: a socket anyone else could use, and a session that refuses inbound messages', async ({
  page,
}) => {
  test.skip(isPhone(), 'Desktop only');
  const open1 = await startTerminal('mode');
  await open1.post('/chmod', { mode: 0o644 });
  await open(page, open1);
  await expect(outcomes(page)).toContainText(
    "This session's messaging address can't be confirmed as its own.",
  );
  const refuse = await startTerminal('inbound');
  await refuse.post('/settings', { value: { crossSessionInbound: 'refuse' } });
  await open(page, refuse);
  await expect(outcomes(page)).toContainText(
    'This session refuses messages from other sessions.',
  );
  await expect(outcomes(page)).toContainText('crossSessionInbound');
  expect((await refuse.state()).frames).toHaveLength(0);
});

test('Refused: another process may hold the session (liveness unknown)', async ({
  page,
}) => {
  test.skip(isPhone(), 'Desktop only');
  const sessionId = `t-twice-${suffix()}`;
  const first = await startTerminal('twice-a', {}, sessionId);
  await startTerminal('twice-b', {}, sessionId);
  await open(page, first);
  await expect(outcomes(page)).toContainText(
    "c9view can't tell whether another process holds this session.",
  );
  await expect(outcomes(page)).toContainText(
    'Nothing is sent or resumed until c9view can tell.',
  );
  await expect(page.getByText(/fork/i)).toHaveCount(0);
});

test('Hold and may-hold warnings leave Send enabled', async ({ page }) => {
  test.skip(isPhone(), 'Desktop only');
  const hold = await startTerminal('warn-hold');
  await hold.post('/settings', { value: { crossSessionInbound: 'hold' } });
  await open(page, hold);
  await composer(page).fill('Still allowed');
  await expect(outcomes(page)).toContainText(
    'This session holds messages until you let them in at the terminal.',
  );
  await expect(sendButton(page)).toBeEnabled();
  const maybe = await startTerminal('warn-bypass', {
    permissionMode: 'bypassPermissions',
  });
  await open(page, maybe);
  await composer(page).fill('Still allowed');
  await expect(outcomes(page)).toContainText(
    'This session may hold messages from c9view',
  );
  await expect(sendButton(page)).toBeEnabled();
});

test('When the process exits the composer becomes a reply, text kept, nothing sent', async ({
  page,
}) => {
  test.skip(isPhone(), 'Desktop only');
  test.setTimeout(60_000);
  const terminal = await startTerminal('exit');
  await open(page, terminal);
  await expect(sendButton(page)).toBeVisible();
  await composer(page).fill('Typed before it ended');
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url());
  });
  await terminal.post('/exit');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(composer(page)).toHaveValue('Typed before it ended');
  expect(posts).toEqual([]);
});

test('A decision pending in the terminal is approved in the terminal', async ({
  page,
}) => {
  test.skip(isPhone(), 'Desktop only');
  const terminal = await startTerminal('decision', {
    live: { status: 'waiting' },
  });
  await open(page, terminal);
  await expect(
    page.getByText(
      'Claude is waiting for a decision. Approve in the terminal.',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: /allow|approve|deny/i }),
  ).toHaveCount(0);
});

test('Only c9view messages carry the label, and it survives a reload', async ({
  page,
}) => {
  const terminal = await startTerminal('label');
  await open(page, terminal);
  await terminal.post('/human', { text: 'Typed in the terminal' });
  await expect(
    page.getByLabel('Conversation messages').getByText('Typed in the terminal'),
  ).toBeVisible();
  await send(page, 'Sent via c9view');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 4000,
  });
  const label = page.getByRole('note', { name: 'Sent from c9view' });
  await expect(label).toHaveCount(1);
  await expect(label).toBeVisible();
  await expect(label).toContainText('Sent from c9view');
  // No label on the terminal prompt: it is the only other user bubble.
  await expect(page.getByRole('note')).toHaveCount(1);
  // The receipt is gone after a reload; the transcript metadata remains.
  await page.reload();
  await expect(
    page
      .getByLabel('Conversation messages')
      .getByText('Sent via c9view', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('note', { name: 'Sent from c9view' }),
  ).toHaveCount(1);
});

test('A marker c9view cannot confirm says so', async ({ page }) => {
  test.skip(isPhone(), 'Desktop only');
  const terminal = await startTerminal('unverified', { unverified: true });
  await open(page, terminal);
  await send(page, 'Unconfirmed sender');
  const label = page.getByRole('note', {
    name: "Marked as sent from c9view; c9view can't confirm this after a restart",
  });
  await expect(label).toBeVisible({ timeout: 6000 });
  await expect(label).toContainText('not confirmed');
});

test('Phone: keyboard send, focus, outcome announced once, no overflow, 44 px targets', async ({
  page,
}) => {
  test.skip(!isPhone(), 'Phone only');
  const terminal = await startTerminal('phone');
  await open(page, terminal);
  const button = sendButton(page);
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await overflow(page)).toBe(false);
  // Collect what the live region says.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { announced: string[] }).announced = seen;
    const region = document.getElementById('reply-status')!;
    new MutationObserver(() => {
      const text = region.textContent ?? '';
      if (text && seen.at(-1) !== text) seen.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await composer(page).fill('Typed on a phone');
  await composer(page).press('Control+Enter');
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 4000,
  });
  await expect(composer(page)).toBeFocused();
  expect(await overflow(page)).toBe(false);
  const announced = await page.evaluate(
    () => (window as unknown as { announced: string[] }).announced,
  );
  expect(announced.filter((text) => text === newTurn)).toHaveLength(1);
  expect(
    announced.filter((text) => text === sentText).length,
  ).toBeLessThanOrEqual(1);
  const label = page.getByRole('note', { name: 'Sent from c9view' });
  await expect(label).toBeVisible();
  expect(await overflow(page)).toBe(false);
  // Refusal and recovery fit too.
  const refused = await startTerminal('phone-refused', {
    live: { version: '2.1.100' },
  });
  await open(page, refused);
  await expect(outcomes(page)).toContainText(
    'Update Claude Code to 2.1.318 or newer.',
  );
  expect(await overflow(page)).toBe(false);
  // The longest refusal text (reason plus a fix naming a setting) fits as well.
  const inbound = await startTerminal('phone-inbound');
  await inbound.post('/settings', { value: { crossSessionInbound: 'refuse' } });
  await open(page, inbound);
  await expect(outcomes(page)).toContainText('crossSessionInbound');
  await expect(sendButton(page)).toBeDisabled();
  expect(await overflow(page)).toBe(false);
  const disabled = (await sendButton(page).boundingBox())!;
  expect(disabled.height).toBeGreaterThanOrEqual(44);
});

test('Nothing about the socket, token or message text reaches the browser or the logs', async ({
  page,
  playwright,
}) => {
  test.skip(isPhone(), 'Desktop only');
  const sentinel = `sentinel-remote-text-${Date.now()}`;
  const terminal = await startTerminal('privacy');
  const captured: string[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    // Transcript-derived views (session pages, project lists) may show the
    // redacted message; control, receipt, availability and status answers may not.
    if (
      !/\/api\/(machines|m\/local\/(control|health|projects\/[^/]+\/sessions\/[^/]+\/(remote|status)))/.test(
        url,
      )
    )
      return;
    captured.push(`${url}\n${await response.text().catch(() => '')}`);
  });
  await open(page, terminal);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { sse: string[] }).sse = seen;
    const source = new EventSource('/api/events');
    for (const type of ['session', 'status', 'control.remote', 'control.run'])
      source.addEventListener(type, (event) =>
        seen.push((event as MessageEvent).data),
      );
  });
  await send(page, sentinel);
  await expect(outcomes(page).getByText(newTurn)).toBeVisible({
    timeout: 4000,
  });
  await terminal.post('/live', { patch: { status: 'busy' } });
  await page.waitForTimeout(500);
  const sse = await page.evaluate(
    () => (window as unknown as { sse: string[] }).sse,
  );
  const api: APIRequestContext = await playwright.request.newContext({
    extraHTTPHeaders: { 'x-e2e-terminal-token': terminalToken() },
  });
  const output = (
    (await (
      await api.get(`${terminalControllerURL}/server-output`)
    ).json()) as {
      output: string;
    }
  ).output;
  await api.dispose();
  const everything = [...captured, ...sse, output].join('\n');
  const hit = captured.find((item) => item.includes(sentinel));
  expect(
    hit?.split('\n')[0],
    'URL that carried the message text',
  ).toBeUndefined();
  for (const secret of [
    'cc-socks',
    '.sock',
    'peerToken',
    'e2e-sentinel-peer-token',
    'e2e-sentinel-key-file-content',
    sentinel,
  ])
    expect(everything, `leaked ${secret}`).not.toContain(secret);
});
