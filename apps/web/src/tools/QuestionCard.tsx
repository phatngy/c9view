import { toolRecords } from './summary.js';
import { CircleHelp } from 'lucide-react';
import { Result, type ToolResult } from './ToolCard.js';

// Decode against complete option labels: commas may belong to a label.
function selectedOptions(
  answer: string | undefined,
  labels: string[],
): Set<string> {
  if (!answer) return new Set();
  const value = answer;
  const candidates = [...new Set(labels)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const matches = new Map<number, string[] | null>();
  function match(offset: number): string[] | null {
    const cached = matches.get(offset);
    if (cached !== undefined) return cached;
    for (const label of candidates) {
      if (!value.startsWith(label, offset)) continue;
      const end = offset + label.length;
      if (end === value.length) return [label];
      if (!value.startsWith(', ', end)) continue;
      const rest = match(end + 2);
      if (rest) {
        const result = [label, ...rest];
        matches.set(offset, result);
        return result;
      }
    }
    matches.set(offset, null);
    return null;
  }
  const complete = match(0);
  if (complete) return new Set(complete);
  // If free text remains, maximize known labels at delimiter boundaries.
  const partials = new Map<number, string[]>();
  function partial(offset: number): string[] {
    const cached = partials.get(offset);
    if (cached) return cached;
    const boundary = value.indexOf(', ', offset);
    let best = boundary < 0 ? [] : partial(boundary + 2);
    for (const label of candidates) {
      if (!value.startsWith(label, offset)) continue;
      const end = offset + label.length;
      if (end !== value.length && !value.startsWith(', ', end)) continue;
      const found = [label, ...(end === value.length ? [] : partial(end + 2))];
      if (found.length > best.length) best = found;
    }
    partials.set(offset, best);
    return best;
  }
  return new Set(partial(0));
}

export function QuestionCard({
  input,
  results,
  compact,
}: {
  input: Record<string, unknown>;
  results: ToolResult[];
  compact?: boolean | undefined;
}) {
  const failed = results.some((result) => result.isError);
  const waiting = !results.length && input.answers === undefined;
  const answers: Record<string, string> = {};
  if (input.answers && typeof input.answers === 'object')
    for (const [q, a] of Object.entries(input.answers)) answers[q] = String(a);
  const text = results.map((result) => result.text).join('\n');
  for (const match of text.matchAll(/"([^"\n]+)"\s*=\s*"([^"\n]*)"/g))
    answers[match[1]!] = match[2]!;
  const questions = toolRecords(input.questions).map((question) => ({
    question: typeof question.question === 'string' ? question.question : '',
    options: toolRecords(question.options).flatMap((option) =>
      typeof option.label === 'string' ? [{ label: option.label }] : [],
    ),
  }));
  return (
    <div className="space-y-2.5 px-4 py-3.5">
      <div
        className={`flex items-center gap-2 font-semibold ${waiting ? 'text-need-input' : failed ? 'text-danger' : ''}`}
      >
        <CircleHelp size={15} aria-hidden />
        <span>
          {waiting
            ? compact
              ? 'Waiting for your answer'
              : 'Question · waiting for your answer'
            : failed
              ? 'Question · failed'
              : 'Question · answered'}
        </span>
      </div>
      {questions.map((question, index) => (
        <div key={index} className="space-y-2.5">
          <p>{question.question}</p>
          <div className="flex flex-wrap gap-2">
            {(() => {
              const answer = answers[question.question];
              const labels = question.options.map((option) => option.label);
              const selectedLabels = selectedOptions(answer, labels);
              return question.options.map((option, index) => {
                const selected = selectedLabels.has(option.label);
                return (
                  <span
                    key={index}
                    className={`rounded-lg border border-line-strong px-2.5 py-1.5 ${selected ? 'bg-accent-soft text-accent' : ''}`}
                  >
                    {option.label}
                    {selected && <span className="sr-only"> selected</span>}
                  </span>
                );
              });
            })()}
          </div>
        </div>
      ))}
      {!waiting &&
        (failed || !Object.keys(answers).length) &&
        results.map((result, index) => <Result key={index} result={result} />)}
    </div>
  );
}
