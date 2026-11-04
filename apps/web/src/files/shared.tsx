import { HttpError } from '../api.js';
import { Empty, Failure } from '../ui.js';
export function FileFailure({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown;
}) {
  return error instanceof HttpError && error.status === 404 ? (
    <Empty>Project folder not found on this machine</Empty>
  ) : (
    <Failure error={error} retry={retry} />
  );
}
