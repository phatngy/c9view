import type { Message } from '@c9view/api';
import { Badge } from '../../kit/Badge.js';
import { modelFamily, modelLabel } from '../../kit/model.js';
import { ClaudeMark } from './ClaudeMark.js';
import { shortTime } from './time.js';
const familyClasses = {
  opus: 'bg-model-opus/16 text-model-opus',
  sonnet: 'bg-model-sonnet/16 text-model-sonnet',
  haiku: 'bg-model-haiku/16 text-model-haiku',
  fable: 'bg-model-fable/16 text-model-fable',
  other: 'bg-model-other/16 text-model-other',
};
export function AssistantHeader({ message }: { message: Message }) {
  const model = message.model ?? '<synthetic>';
  return (
    <header className="relative flex min-h-8 flex-wrap items-baseline gap-2 text-small">
      <span
        aria-hidden="true"
        className={`absolute top-0 -left-11 grid size-8 place-items-center rounded-[10px] ${familyClasses[modelFamily(model)]}`}
      >
        <ClaudeMark />
      </span>
      <strong className="font-semibold">Claude</strong>
      <span className="text-muted">
        {model === '<synthetic>' ? 'Claude Code' : modelLabel(model)}
        {message.timestamp && (
          <>
            {' '}
            ·{' '}
            <time dateTime={message.timestamp}>
              {shortTime(message.timestamp)}
            </time>
          </>
        )}
      </span>
      {message.isSidechain && <Badge>sidechain</Badge>}
    </header>
  );
}
