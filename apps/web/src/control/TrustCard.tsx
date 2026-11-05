import { Button, Card } from '../kit/index.js';
import { useCardAction, type TrustCardProps } from './cards.js';

export function TrustCard(props: TrustCardProps) {
  return (
    <TrustDecision
      key={`${props.trust.path}/${props.trust.fingerprint}`}
      {...props}
    />
  );
}

function TrustDecision({ trust, onTrust, onCancel, changed }: TrustCardProps) {
  const { submit, error, disabled, pending, done } = useCardAction();
  return (
    <Card
      role="region"
      aria-label={`Trust folder ${trust.path}`}
      className="space-y-3 text-sm"
    >
      <h2 className="font-semibold text-ink">Trust this folder?</h2>
      <p className="text-muted">
        Review what Claude will load before starting a session.
      </p>
      {changed && (
        <p role="status" className="text-need-input">
          This folder’s settings changed since the last summary. Review the
          updated settings before trusting it.
        </p>
      )}
      <dl className="space-y-3">
        <div>
          <dt className="font-medium text-ink">Path</dt>
          <dd className="break-words font-mono text-small text-muted">
            {trust.path}
          </dd>
        </div>
        {(
          [
            ['Hooks', trust.hooks],
            ['MCP servers', trust.mcpServers],
            ['Allow rules', trust.allowRules],
            ['Plugins', trust.plugins],
          ] as const
        ).map(([label, entries]) => (
          <div key={label}>
            <dt className="font-medium text-ink">{label}</dt>
            <dd className="text-muted">
              {entries.length ? (
                <ul className="space-y-1">
                  {entries.map((entry, index) => (
                    <li
                      key={index}
                      className="whitespace-pre-wrap break-words font-mono text-small"
                    >
                      {entry}
                    </li>
                  ))}
                </ul>
              ) : (
                'None'
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt className="font-medium text-ink">CLAUDE.md</dt>
          <dd className="text-muted">
            {trust.hasClaudeMd ? 'Present' : 'Not present'}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() => void submit(onTrust)}
        >
          Trust this folder
        </Button>
        <Button disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-muted">
          Trusting folder…
        </p>
      )}
      {done && (
        <p role="status" className="text-muted">
          Folder trusted.
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
