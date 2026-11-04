import type { NodeResponse } from '@c9view/node';

/** Pull chunks only as the browser consumes them; cancellation releases the iterator. */
export function transportResponse(response: NodeResponse): Response {
  const iterator = response.body[Symbol.asyncIterator]();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await iterator.next();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    }),
    {
      status: response.status,
      headers: { 'Content-Type': response.contentType },
    },
  );
}
