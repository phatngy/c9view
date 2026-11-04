import { MoreHorizontal } from 'lucide-react';
import { IconButton } from '../../kit/IconButton.js';
import { Menu } from '../../kit/Menu.js';
export function MoreMenu({
  sessionId,
  cwd,
  notice,
}: {
  sessionId: string;
  cwd: string | null;
  notice: (message: string) => void;
}) {
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notice('Copied.');
    } catch {
      notice('Copy failed.');
    }
  }
  return (
    <Menu
      trigger={
        <IconButton
          label="More session options"
          icon={MoreHorizontal}
          variant="default"
          className="max-sm:min-h-11"
        />
      }
      items={[
        { label: 'Copy session ID', onSelect: () => void copy(sessionId) },
        {
          label: 'Copy working directory',
          disabled: cwd === null,
          onSelect: () => {
            if (cwd !== null) void copy(cwd);
          },
        },
      ]}
    />
  );
}
