import { useId, useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { Button, Card } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { useCardAction, type PermissionCardProps } from './cards.js';

export function PermissionCard(props: PermissionCardProps) {
  return <PermissionDecision key={props.request.requestId} {...props} />;
}

function PermissionDecision({ request, onDecide }: PermissionCardProps) {
  const id = useId();
  const [withMessage, setWithMessage] = useState(false);
  const [message, setMessage] = useState('');
  const { submit, error, disabled, pending, done } = useCardAction();
  return (
    <Card
      role="region"
      tabIndex={-1}
      aria-label={`Permission for ${request.toolName}`}
      className={`p-3! text-sm ${focusRing}`}
    >
      <div className="flex min-h-10 min-w-0 items-start gap-2.5">
        <ShieldQuestion
          size={15}
          aria-hidden="true"
          className="mt-1 shrink-0 text-need-input"
        />
        <span className="shrink-0 font-medium text-ink">
          {request.toolName}
        </span>
        <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-small text-muted">
          {request.summary}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted">
        Expires{' '}
        <time dateTime={request.expiresAt}>
          {new Date(request.expiresAt).toLocaleString()}
        </time>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (withMessage)
            void submit(() => onDecide({ decision: 'deny', message }));
        }}
      >
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void submit(() => onDecide({ decision: 'allow' }))}
            >
              Allow
            </Button>
            <Button
              size="sm"
              onClick={() => void submit(() => onDecide({ decision: 'deny' }))}
            >
              Deny
            </Button>
            <Button
              size="sm"
              aria-expanded={withMessage}
              aria-controls={`${id}-message`}
              onClick={() => setWithMessage(!withMessage)}
            >
              Deny with a message
            </Button>
          </div>
          {withMessage && (
            <div id={`${id}-message`} className="space-y-2">
              <label
                htmlFor={`${id}-text`}
                className="block font-medium text-ink"
              >
                Message to Claude
              </label>
              <textarea
                id={`${id}-text`}
                maxLength={2000}
                value={message}
                onChange={(event) =>
                  setMessage(event.target.value.slice(0, 2000))
                }
                rows={3}
                aria-describedby={`${id}-count`}
                className={`w-full min-h-11 rounded-md border border-line bg-raised p-2 text-ink ${focusRing}`}
              />
              <p id={`${id}-count`} className="text-xs text-muted">
                {message.length} / 2,000 characters
              </p>
              <Button size="sm" type="submit">
                Send denial
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      {pending && (
        <p role="status" className="mt-2 text-muted">
          Sending decision…
        </p>
      )}
      {done && (
        <p role="status" className="mt-2 text-muted">
          Decision sent.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
