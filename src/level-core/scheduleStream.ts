// Lazy schedule enumeration (Pillar 2 / §3.2).
// Wraps an AsyncIterable<Schedule> so that filter/map/take/branch stay lazy
// and only bestBy/paretoFrontier/collect actually drain.

import type { Schedule, ScheduleStream, Scorer } from "./types.ts";

export class ScheduleStreamImpl implements ScheduleStream {
  constructor(private readonly source: AsyncIterable<Schedule>) {}

  [Symbol.asyncIterator](): AsyncIterator<Schedule> {
    return this.source[Symbol.asyncIterator]();
  }

  filter(pred: (s: Schedule) => boolean): ScheduleStream {
    const source = this.source;
    return new ScheduleStreamImpl({
      async *[Symbol.asyncIterator]() {
        for await (const s of source) {
          if (pred(s)) yield s;
        }
      },
    });
  }

  map(fn: (s: Schedule) => Schedule): ScheduleStream {
    const source = this.source;
    return new ScheduleStreamImpl({
      async *[Symbol.asyncIterator]() {
        for await (const s of source) yield fn(s);
      },
    });
  }

  take(k: number): ScheduleStream {
    const source = this.source;
    return new ScheduleStreamImpl({
      async *[Symbol.asyncIterator]() {
        if (k <= 0) return;
        let n = 0;
        for await (const s of source) {
          yield s;
          if (++n >= k) return;
        }
      },
    });
  }

  branch(fork: (s: Schedule) => ScheduleStream): ScheduleStream {
    const source = this.source;
    return new ScheduleStreamImpl({
      async *[Symbol.asyncIterator]() {
        for await (const s of source) {
          for await (const child of fork(s)) yield child;
        }
      },
    });
  }

  async bestBy(scorer: Scorer): Promise<Schedule | null> {
    let bestSchedule: Schedule | null = null;
    let bestScore: number | null = null;
    for await (const s of this.source) {
      const score = scorer.score(s);
      if (
        bestScore === null ||
        (scorer.direction === "min" ? score < bestScore : score > bestScore)
      ) {
        bestScore = score;
        bestSchedule = s;
      }
    }
    return bestSchedule;
  }

  async paretoFrontier(scorers: ReadonlyArray<Scorer>): Promise<ReadonlyArray<Schedule>> {
    const collected: { schedule: Schedule; scores: number[] }[] = [];
    for await (const s of this.source) {
      collected.push({
        schedule: s,
        scores: scorers.map((sc) => sc.score(s)),
      });
    }
    const frontier: Schedule[] = [];
    for (const candidate of collected) {
      let dominated = false;
      for (const other of collected) {
        if (other === candidate) continue;
        if (dominates(other.scores, candidate.scores, scorers)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) frontier.push(candidate.schedule);
    }
    return frontier;
  }

  async collect(limit?: number): Promise<ReadonlyArray<Schedule>> {
    const out: Schedule[] = [];
    for await (const s of this.source) {
      out.push(s);
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }
}

// `a` dominates `b` iff a is at least as good on every scorer and strictly
// better on at least one.
function dominates(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  scorers: ReadonlyArray<Scorer>,
): boolean {
  let strictlyBetter = false;
  for (let i = 0; i < scorers.length; i++) {
    const dir = scorers[i]!.direction;
    const ai = a[i]!;
    const bi = b[i]!;
    const aBetter = dir === "min" ? ai < bi : ai > bi;
    const aWorse = dir === "min" ? ai > bi : ai < bi;
    if (aWorse) return false;
    if (aBetter) strictlyBetter = true;
  }
  return strictlyBetter;
}

// Convenience constructor — wraps a one-shot AsyncGenerator factory in a
// reusable AsyncIterable so multiple consumers each get a fresh iterator.
export function streamFromFactory(factory: () => AsyncGenerator<Schedule>): ScheduleStream {
  return new ScheduleStreamImpl({
    [Symbol.asyncIterator]: factory,
  });
}
