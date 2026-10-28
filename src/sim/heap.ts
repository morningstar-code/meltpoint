// Binary min-heap of timed events. Ties break on insertion order, which keeps runs
// deterministic when many events land on the same millisecond.

export interface Timed {
  t: number;
  seq: number;
}

export class EventHeap<T extends Timed> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(items[i], items[p])) break;
      [items[i], items[p]] = [items[p], items[i]];
      i = p;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && before(items[l], items[m])) m = l;
        if (r < n && before(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top;
  }

  clear(): void {
    this.items = [];
  }
}

function before(a: Timed, b: Timed): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}
