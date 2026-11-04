import type { Message, SessionDetailResponse } from '@c9view/api';
import { summarizeInput } from './model.js';

export const EXPORT_LIMIT = 20_000;
export async function collectExport(
  fetchPage: (
    cursor: number,
    signal: AbortSignal,
  ) => Promise<SessionDetailResponse>,
  signal: AbortSignal,
  progress: (count: number) => void,
) {
  const messages: Message[] = [];
  const ids = new Set<string>();
  const cursors = new Set<number>();
  let cursor: number | null = 0;
  let session: SessionDetailResponse['session'] | undefined;
  while (cursor !== null && messages.length < EXPORT_LIMIT) {
    signal.throwIfAborted();
    if (cursors.has(cursor)) throw new Error('Paging did not advance.');
    cursors.add(cursor);
    const page = await fetchPage(cursor, signal);
    signal.throwIfAborted();
    session ??= page.session;
    const previousCount = messages.length;
    for (const message of page.messages)
      if (!ids.has(message.uuid) && messages.length < EXPORT_LIMIT) {
        ids.add(message.uuid);
        messages.push(message);
      }
    progress(messages.length);
    if (messages.length === previousCount && page.nextCursor !== null)
      throw new Error('Paging returned no new messages.');
    cursor = page.nextCursor;
  }
  return { session, messages, truncated: cursor !== null };
}
function fence(text: string, language = '') {
  let longest = 2;
  for (const match of text.matchAll(/`+/g))
    longest = Math.max(longest, match[0].length);
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter}${language}\n${text}\n${delimiter}`;
}
export function exportMarkdown(
  title: string,
  messages: Message[],
  truncated = false,
) {
  const heading = title.replace(/\s+/g, ' ').trim().replace(/^#/, '\\#');
  return [
    `# ${heading}\n\n${truncated ? 'Export limited to 20,000 messages.\n\n' : ''}`,
    ...messages.map(
      (message) =>
        `\n\n## ${message.role} · ${message.timestamp ?? 'Unknown time'}${message.model ? ` · ${message.model}` : ''}\n\n` +
        message.blocks
          .map((block) => {
            switch (block.type) {
              case 'text':
                // Preserve ordinary Markdown, but escape headings and every backtick/tilde
                // run so message text cannot introduce headings or unclosed fences.
                return block.text
                  .replace(/^( {0,3})(#+)/gm, '$1\\$2')
                  .replace(/`+/g, (run) =>
                    run
                      .split('')
                      .map(() => '\\`')
                      .join(''),
                  )
                  .replace(/~{3,}/g, (run) =>
                    run
                      .split('')
                      .map(() => '\\~')
                      .join(''),
                  );
              case 'thinking':
                return `### Thinking\n\n${fence(block.text)}`;
              case 'image':
                return '[Image attachment]';
              case 'tool_use':
                return `### Tool: ${block.name}\n\n${fence(summarizeInput(block.input), 'json')}`;
              case 'tool_result':
                return `### Tool result${block.isError ? ' (error)' : ''}\n\n${fence(block.text.slice(0, 2000))}${block.text.length > 2000 ? '\n\n[Truncated to 2,000 characters for export.]' : ''}`;
            }
          })
          .join('\n\n'),
    ),
  ];
}

// Serialize each message separately: Blob consumes these parts without a joined export string.
export function exportJson(
  data: Awaited<ReturnType<typeof collectExport>>,
): BlobPart[] {
  return [
    `{"session":${JSON.stringify(data.session ?? null)},"truncated":${data.truncated},"messages":[`,
    ...data.messages.map(
      (message, index) =>
        `${index ? ',' : ''}\n${JSON.stringify(message, null, 2)}`,
    ),
    '\n]}',
  ];
}
