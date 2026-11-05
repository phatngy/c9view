import { useId, useState } from 'react';
import { Button, Card } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { useCardAction, type QuestionCardProps } from './cards.js';

interface Answer {
  selected: number[];
  other: boolean;
  text: string;
}
const emptyAnswer = (): Answer => ({ selected: [], other: false, text: '' });

export function QuestionCard(props: QuestionCardProps) {
  return <QuestionDecision key={props.request.requestId} {...props} />;
}

function QuestionDecision({ request, onDecide, layout }: QuestionCardProps) {
  const id = useId();
  const [values, setValues] = useState<Answer[]>(() =>
    request.questions.map(emptyAnswer),
  );
  const { submit, error, disabled, pending, done } = useCardAction();
  const valid = values.every(
    (value) =>
      (value.selected.length > 0 || value.other) &&
      (!value.other || value.text.trim().length > 0),
  );
  function update(index: number, value: Answer) {
    setValues((current) =>
      current.map((answer, i) => (i === index ? value : answer)),
    );
  }
  return (
    <Card
      role="region"
      tabIndex={-1}
      aria-label={`Questions: ${request.questions.map(({ question }) => question).join('; ')}`}
      data-layout={layout}
      className={`${layout === 'pinned' ? 'p-3! text-sm' : 'p-4! text-sm'} ${focusRing}`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          const answers = Object.fromEntries(
            request.questions.map((question, index) => {
              const value = values[index]!;
              const labels = value.selected.map(
                (option) => question.options[option]!.label,
              );
              // Other is free text, never the literal label "Other".
              const answer = value.other
                ? value.text
                : question.multiSelect
                  ? labels
                  : labels[0]!;
              return [question.question, answer];
            }),
          );
          void submit(() => onDecide({ answers }));
        }}
        className="space-y-3"
      >
        {request.questions.map((question, index) => {
          const value = values[index]!;
          const questionId = `${id}-${index}`;
          return (
            <fieldset
              key={questionId}
              disabled={disabled}
              className="min-w-0 space-y-2"
            >
              <legend className="mb-1 font-medium text-ink">
                {question.header}
                <span className="mt-1 block whitespace-pre-wrap break-words font-normal">
                  {question.question}
                </span>
              </legend>
              <p className="text-xs text-muted">
                {question.multiSelect
                  ? 'Select one or more options, or choose Other.'
                  : 'Select one option.'}
              </p>
              {question.options.map((option, optionIndex) => (
                <label
                  key={optionIndex}
                  className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 has-disabled:cursor-not-allowed has-disabled:opacity-40 max-lg:min-h-11"
                >
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={questionId}
                    checked={value.selected.includes(optionIndex)}
                    aria-describedby={`${questionId}-description-${optionIndex}`}
                    className={`size-4 shrink-0 accent-accent ${focusRing}`}
                    onChange={() =>
                      update(index, {
                        ...value,
                        other: false,
                        selected: question.multiSelect
                          ? value.selected.includes(optionIndex)
                            ? value.selected.filter(
                                (selected) => selected !== optionIndex,
                              )
                            : [...value.selected, optionIndex].sort(
                                (a, b) => a - b,
                              )
                          : [optionIndex],
                      })
                    }
                  />
                  <span className="min-w-0 break-words">
                    <span className="font-medium text-ink">{option.label}</span>
                    <span
                      id={`${questionId}-description-${optionIndex}`}
                      className="block text-muted"
                    >
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 has-disabled:cursor-not-allowed has-disabled:opacity-40 max-lg:min-h-11">
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={questionId}
                  checked={value.other}
                  className={`size-4 shrink-0 accent-accent ${focusRing}`}
                  onChange={() =>
                    update(index, {
                      ...value,
                      other: !value.other,
                      selected: [],
                    })
                  }
                />
                <span className="text-ink">Other</span>
              </label>
              {value.other && (
                <div className="space-y-1">
                  <label
                    htmlFor={`${questionId}-other`}
                    className="block text-ink"
                  >
                    Other answer for {question.header}
                  </label>
                  <input
                    id={`${questionId}-other`}
                    type="text"
                    value={value.text}
                    maxLength={2000}
                    aria-describedby={`${questionId}-count`}
                    onChange={(event) =>
                      update(index, {
                        ...value,
                        text: event.target.value.slice(0, 2000),
                      })
                    }
                    className={`w-full min-h-9 rounded-md border border-line bg-raised px-3 py-2 text-ink max-lg:min-h-11 ${focusRing}`}
                  />
                  <p id={`${questionId}-count`} className="text-xs text-muted">
                    {value.text.length} / 2,000 characters
                  </p>
                </div>
              )}
            </fieldset>
          );
        })}
        <p className="text-xs text-muted">
          Expires{' '}
          <time dateTime={request.expiresAt}>
            {new Date(request.expiresAt).toLocaleString()}
          </time>
        </p>
        <Button
          size="sm"
          type="submit"
          variant="primary"
          disabled={disabled || !valid}
        >
          Submit answers
        </Button>
      </form>
      {pending && (
        <p role="status" className="mt-2 text-muted">
          Sending answers…
        </p>
      )}
      {done && (
        <p role="status" className="mt-2 text-muted">
          Answers sent.
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
