import { toolRecords } from './summary.js';
export function TodoCard({ todos }: { todos: unknown }) {
  return (
    <ul aria-label="Todos" className="space-y-2 px-3.5 pb-3">
      {toolRecords(todos).map((todo, index) => (
        <li key={index} className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`size-3.5 shrink-0 rounded ${todo.status === 'completed' ? 'bg-success' : todo.status === 'in_progress' ? 'border-2 border-in-progress' : 'border-2 border-line-strong'}`}
          />
          <span
            className={
              todo.status === 'completed' ? 'text-muted line-through' : ''
            }
          >
            {String(todo.content ?? '')}
          </span>
          <span className="sr-only">
            {todo.status === 'in_progress' ? '' : String(todo.status ?? '')}
          </span>
          {todo.status === 'in_progress' && (
            <span className="text-xs text-in-progress">in progress</span>
          )}
        </li>
      ))}
    </ul>
  );
}
