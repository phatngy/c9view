export class Queue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake?: () => void;
  private ended = false;
  push(value: T) {
    if (!this.ended) {
      this.values.push(value);
      this.wake?.();
    }
  }
  close() {
    this.ended = true;
    this.values = [];
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (!this.ended) {
      const value = this.values.shift();
      if (value !== undefined) yield value;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}
