// Block contract for `@mpp-next/level-blocks` (N4 / §4.2).
//
// A Block is the LCNC composition unit: a typed quadruple shared by the
// visual editor (Pillar 3), the LLM agent (Pillar 4), and the compiler.
// Three families differ only in the output type `O`:
//
//   • Constraint blocks  — O = Constraint
//   • Scoring blocks     — O = Scorer
//   • Search blocks      — O = Search | SearchTransformer
//
// Constraint variants are the *interchange format* between Constraint blocks
// and Search; the ADT is the wire, the Block is the cable.

import type { ZodType } from "zod";

import type { Constraint, Scorer, Search, SearchTransformer } from "../level-core/types.ts";

/** Top-level MiniZinc text emitted for a single block — `constraint`,
 *  `var`, `array`, etc. The compiler concatenates fragments and resolves
 *  shared symbols (`active[t,d]`, `tasks_demanding[r]`, `DAYS`). */
export interface MiniZincFragment {
  readonly text: string;
}

/** Optional escape hatch (R1) for blocks where MiniZinc → FlatZinc loses
 *  structure the underlying CP-SAT model can express directly. */
export interface CpSatFragment {
  readonly text: string;
}

export interface BlockDoc {
  readonly nl: string;
  readonly pseudocode: string;
}

export interface Block<I, O> {
  readonly id: string;
  readonly schema: {
    readonly input: ZodType<I>;
    readonly output: ZodType<O>;
  };
  apply(input: I): O;
  toMiniZinc(input: I): MiniZincFragment;
  toCpSat?(input: I): CpSatFragment;
  readonly doc: BlockDoc;
}

export type ConstraintBlock<I> = Block<I, Constraint>;
export type ScoringBlock<I> = Block<I, Scorer>;
export type SearchBlock<I> = Block<I, Search | SearchTransformer>;
