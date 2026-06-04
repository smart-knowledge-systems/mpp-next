# Literature Review — Research Behind the Resource-Leveling Engine

`levelset` pairs a Microsoft Project file toolkit (read/write `.mpp`, MSPDI, CSV, XLSX) with a functional resource-leveling engine. The leveling engine is not an ad-hoc heuristic: its architecture is grounded in published research across constraint programming, project scheduling, solution diversity, hyper-heuristics, LLM-assisted optimization modeling, and forecasting for resource-loaded schedules.

This document summarizes each source we drew on — what it establishes, the ideas that carry weight, and how it shapes the engine's design. Full citations with DOIs are collected at the end.

## The design in one paragraph

Four ideas underpin the engine. First, a **compositional, functional substrate**: constraints, scoring, and search strategies are first-class, composable values, so a leveling algorithm is _authored_ by composition rather than chosen from a fixed menu. Second, **lazy enumeration**: feasible schedules are exposed as a stream of views — best-by-score, Pareto-diverse, or forecasted — instead of a single answer. Third, **low-code composition**: the constraint/scoring/search vocabulary is a palette of blocks, which frames the whole system as a hyper-heuristic search space. Fourth, **LLM-assisted synthesis**: that same block vocabulary is a target a language model can parameterize or extend. The motivating problem is resource leveling in project management — smoothing the demand a project's tasks place on shared crews, equipment, and other limited resources over time — the classic resource-constrained project scheduling setting.

---

## Compositional constraint programming

### Monadic Constraint Programming — Schrijvers, Stuckey & Wadler (2009)

**Core idea.** A constraint-programming system can be expressed as a _Solver_ monad that encapsulates constraint-store state, with a _Tree_ free-monad layer adding nondeterminism (`Try`, `Fail`), and **search strategies as first-class composable transformers** — depth-first, limited-discrepancy, branch-and-bound, restart — that thread the solver through the search tree.

**Why it matters here.** This is the direct blueprint for the engine's search interface: a `Search` is a value, and strategies are `SearchTransformer`s that wrap one search to produce another. TypeScript async generators are the practical realization of the Tree monad's nondeterminism.

### Handling Algebraic Effects — Plotkin & Pretnar (2013)

**Core idea.** Computational effects (state, I/O, nondeterminism) are operations on a free model of an equational theory; _handlers_ interpret those operations at the use site. This generalizes the monadic framing — many handlers reuse one operation set. Nondeterminism is a single `choose` operation; list, set, and search traversal are different handlers of it.

**Why it matters here.** It makes the "generators are sufficient" decision principled rather than expedient: a generator _is_ a handler of the choose effect — `yield` is the operation, and the consuming runtime is the handler. Heavier algebraic-effect machinery only earns its keep at larger scale.

### FreeCHR: An Algebraic Framework for CHR Embeddings — Rechenberger & Frühwirth (2025)

**Core idea.** Constraint Handling Rules — whose programs are _simplification_ and _propagation_ rules over a constraint store — can be embedded into any host language by formalizing CHR syntax as an endofunctor over a constraint multiset, with operational semantics given by the free algebra. The result is a proven-correct internal DSL with no external compiler.

**Why it matters here.** The simplify/propagate shape is the cleanest template for a user extension point: a `propagate(store) → store'` plus a `decompose(store) → fragment` pair. FreeCHR is the closest existing model for porting that surface to TypeScript.

### MiniZinc: Towards a Standard CP Modelling Language — Nethercote et al. (2007)

**Core idea.** A solver-independent modeling language compiles to a low-level form (FlatZinc) via predicate inlining, comprehension unrolling, Boolean/numeric decomposition, and reification. Native global constraints (`all_different`, `cumulative`, `disjunctive`, `circuit`) are preserved when the target solver supports them and decomposed otherwise.

**Why it matters here.** MiniZinc is the modeling lingua franca for the heavy backend. The engine's two-layer compilation — high-level blocks down to a solver-facing model — mirrors the MiniZinc → FlatZinc split, and each block emits a MiniZinc fragment as its portable target.

---

## Constraint solving for scheduling

### Lazy Clause Generation Reengineered — Feydy & Stuckey (2009)

**Core idea.** A hybrid of finite-domain propagation and SAT solving in which FD propagators emit _explanation clauses_ on demand and the SAT engine drives nogood learning, conflict-directed backjumping, and VSIDS variable selection. It inverts the usual "SAT as master" picture: SAT is a global propagator _inside_ the FD engine. The payoff is orders-of-magnitude fewer choice points on scheduling problems, often beating hand-tuned search.

**Why it matters here.** It justifies delegating hard solves to a mature LCG-based solver (e.g. CP-SAT / Chuffed) rather than reimplementing constraint propagation — re-creating LCG well is a multi-year effort.

### Solving RCPSP/max by Lazy Clause Generation — Schutt, Feydy, Stuckey & Wallace (2013)

**Core idea.** Applying LCG to the resource-constrained project scheduling problem with generalized precedences (RCPSP/max) closes 573 previously open benchmark instances and dominates prior exact and heuristic methods on both quality and proof of optimality.

**Key components.** Cumulative constraint with timetable (compulsory-part) propagation; a generalized-precedence propagator with constant-time time-lag updates; disjunctive arcs as half-reified mutual exclusion; Bellman–Ford domain preprocessing on the precedence-with-time-lags graph.

**Why it matters here.** This is the concrete proof point that the resource-leveling problem class is well within reach of an LCG backend. The Bellman–Ford preprocessing is a cheap, solver-agnostic win worth doing on the modeling side.

---

## Enumerating and diversifying schedules

### Finding Diverse and Similar Solutions in Constraint Programming — Hebrard, Hnich, O'Sullivan & Walsh (2005)

**Core idea.** Defines the complexity of diversity/similarity problems and gives global constraints over Hamming distance to enumerate sets that are _k_-best-and-diverse.

**Key results.**

- **Sum-of-distances diversity** (`Diverse_Σ`, total pairwise distance ≥ _d_): can be maintained generalized-arc-consistent in `O(n(d+k))` via value-occurrence counts.
- **Min-distance diversity** (`Diverse_min`): **NP-hard** to maintain GAC — use branch-and-bound with an incremental distance threshold instead.
- A greedy "pick the most-distant next" approximation is a usable fallback.

**Why it matters here.** When the engine offers a _diverse_ set of schedules rather than one, sum-of-distances diversity is the form that is realistically a propagator; min-distance diversity must be approached by search.

### LSSPER: Solving RCPSP with Large Neighbourhood Search — Palpant, Artigues & Michelon (2004)

**Core idea.** Large-neighbourhood search where each iteration freezes part of the current schedule and solves the unfrozen subproblem exactly (CP or ILP). The **subproblem _generation_ matters more than the subproblem _solver_.**

**Key components.** Block selection (pick a random activity, include everything contiguous or parallel to it) decisively beats random, critical-path, and predecessor neighborhoods; self-adaptive subproblem size based on recent solve times; forward/backward post-optimization passes; periodic restart for diversification. Results land within 0.02–0.22% of optimal on standard benchmarks, beating genetic-algorithm and tabu approaches.

**Why it matters here.** It settles a design choice that would otherwise be taste: an LNS "destroy" operator should use contiguous/parallel block selection, not critical-path or predecessor neighborhoods.

---

## Composition and hyper-heuristics

### Hyper-heuristics: A Survey of the State of the Art — Burke et al. (2013)

**Core idea.** Hyper-heuristics search a space of _heuristics_ rather than a space of solutions, split into **selection** (choose among existing low-level heuristics) and **generation** (construct new ones, e.g. by genetic programming).

**Why it matters here.** It frames the block palette as exactly such a search space: composing blocks to parameterize known strategies is selection; synthesizing new block logic is generation. This is the conceptual lineage the LLM-assisted layer extends into a _language_ hyper-heuristic.

---

## LLM-assisted optimization modeling

### OptiMUS — AhmadiTeshnizi, Gao, Brunborg, Talaei & Udell (2024)

**Core idea.** A _modular_ pipeline (parameter extraction → clause formulation → per-clause code generation → assembly → debugging) outperforms open-ended agent loops at current model capability. Two pieces carry the result: a **connection graph** — a bipartite clause↔parameter graph, so each model call sees only the parameters relevant to its clause, avoiding long-prompt failure modes — and **reflective error correction**, where the model reviews its own output (e.g. "are the units consistent on both sides of this constraint?"), roughly halving errors on hard problems. Modular per-clause generation also means a new model release can be adopted with no fine-tuning.

**Why it matters here.** It is the template for natural-language → constraint-block translation: parameterize the existing block vocabulary clause by clause, with a connection graph keeping each call focused and reflection catching unit/scale errors.

### Mathematical Discoveries from Program Search with LLMs (FunSearch) — Romera-Paredes et al. (2024)

**Core idea.** An LLM paired with an evaluator inside an island-model evolutionary loop searches the space of _programs_ (not solutions), discovering a new cap-set lower bound and bin-packing heuristics that beat First-Fit-Decreasing.

**Key components.** Island-model evolution with periodic migration; **best-shot prompting** — sample the _k_ best programs from an island, sort by score, and feed all _k_ into the next prompt (_k_ = 2 is the sweet spot); and **skeleton evolution** — fix the known structure and evolve only the critical inner function (e.g. the priority function of a greedy scheduler).

**Why it matters here.** For synthesizing leveling logic, it argues for evolving a _program skeleton_ — the priority/tiebreak function of the schedule-generation scheme — rather than whole blocks, and for small-population best-shot prompting over single-thread reflect-and-iterate.

---

## Domain grounding: workflow allocation, takt and location-based scheduling

### Benchmarking ASP Systems for Resource Allocation in Business Processes — Havur, Cabanillas & Polleres (2022)

**Core idea.** Formalizes Resource Allocation in Business Processes (a process model plus a role-based organizational model, temporal model, and makespan objective) and provides a parameterizable benchmark generator for answer-set-programming solvers. The **resource-strength** parameter drives difficulty exponentially — hardest at low strength / high disjunctiveness.

**Why it matters here.** It is the closest published analog to "resource leveling in a workflow," and a usable benchmark template. It also names a constraint family — role hierarchies and role-based access — beyond the current project-scheduling scope but worth tracking for future work.

### Integrated Forecasting for Takt and Location-Based Scheduling — Seppänen et al. (2025)

**Core idea.** Extends location-based management system (LBMS) forecasting to takt production by adding capacity-buffer accounting. From a partial schedule plus actual progress it forecasts remaining duration and buffer exhaustion, driving proactive control (add capacity, stop the line, resequence). On a real project it identified a bottleneck and predicted a multi-period delay.

**Why it matters here.** Resource leveling does not end at the baseline. Once work is under way, a forecasting view — partial schedule + actual progress → forecast remaining + buffer status — is a natural read-side feature for a schedule stream, and a far less ambitious slice than full reactive rescheduling.

---

## How the research shapes the engine

Choices the literature directly supports:

- **Heavy solving belongs in an LCG-based backend.** Lazy clause generation is genuinely state of the art for scheduling (Feydy & Stuckey; Schutt et al.), so the engine targets such a solver rather than reimplementing propagation.
- **MiniZinc is the modeling DSL.** Its global-constraint vocabulary is the common tongue; blocks compile to MiniZinc fragments (Nethercote et al.).
- **Generator-based effects are sufficient for the in-process tier.** Plotkin & Pretnar make this defensible without higher-kinded-type plumbing.
- **The simplify/propagate shape is the extension surface** (FreeCHR).
- **Search strategies are composable transformers** (monadic CP).

Choices the literature _sharpens_:

- **Diversity via sum-of-distances**, not min-distance (Hebrard et al.): the former is a tractable propagator, the latter NP-hard to keep consistent.
- **LNS destroy uses contiguous/parallel block selection** (LSSPER), not critical-path or predecessor neighborhoods.
- **LLM synthesis evolves a program skeleton** — the priority function — with small-population best-shot prompting (FunSearch), rather than whole-block synthesis.
- **Natural-language modeling is modular and connection-graph driven**, with reflective error correction (OptiMUS).
- **Per-task mode selection** (discrete crew/duration modes) is a first-class lever, matching multi-mode RCPSP and the realities of crew-sizing in project scheduling.
- **A forecasting view** fits the read-side of the schedule stream (Seppänen et al.).

---

## References

1. Schrijvers, T., Stuckey, P. J., & Wadler, P. (2009). _Monadic constraint programming._ Journal of Functional Programming, 19(6), 663–697. [doi:10.1017/S0956796809990086](https://doi.org/10.1017/S0956796809990086)
2. Plotkin, G. D., & Pretnar, M. (2013). _Handling algebraic effects._ Logical Methods in Computer Science, 9(4:23). [doi:10.2168/LMCS-9(4:23)2013](https://doi.org/10.2168/LMCS-9%284%3A23%292013)
3. Rechenberger, S., & Frühwirth, T. (2025). _FreeCHR — An algebraic framework for Constraint Handling Rules embeddings._ Theory and Practice of Logic Programming, 25(3), 340–373. [doi:10.1017/S1471068425000043](https://doi.org/10.1017/S1471068425000043)
4. Nethercote, N., Stuckey, P. J., Becket, R., Brand, S., Duck, G. J., & Tack, G. (2007). _MiniZinc: Towards a standard CP modelling language._ In Principles and Practice of Constraint Programming – CP 2007, LNCS 4741, 529–543. [doi:10.1007/978-3-540-74970-7_38](https://doi.org/10.1007/978-3-540-74970-7_38)
5. Feydy, T., & Stuckey, P. J. (2009). _Lazy clause generation reengineered._ In Principles and Practice of Constraint Programming – CP 2009, LNCS 5732, 352–366. [doi:10.1007/978-3-642-04244-7_29](https://doi.org/10.1007/978-3-642-04244-7_29)
6. Schutt, A., Feydy, T., Stuckey, P. J., & Wallace, M. G. (2013). _Solving RCPSP/max by lazy clause generation._ Journal of Scheduling, 16, 273–289. [doi:10.1007/s10951-012-0285-x](https://doi.org/10.1007/s10951-012-0285-x)
7. Hebrard, E., Hnich, B., O'Sullivan, B., & Walsh, T. (2005). _Finding diverse and similar solutions in constraint programming._ In Proceedings of AAAI 2005, 372–377. [aaai.org](https://aaai.org/papers/00372-aaai05-059-finding-diverse-and-similar-solutions-in-constraint-programming/)
8. Palpant, M., Artigues, C., & Michelon, P. (2004). _LSSPER: Solving the resource-constrained project scheduling problem with large neighbourhood search._ Annals of Operations Research, 131, 237–257. [doi:10.1023/B:ANOR.0000039521.26237.62](https://doi.org/10.1023/B:ANOR.0000039521.26237.62)
9. Burke, E. K., Gendreau, M., Hyde, M., Kendall, G., Ochoa, G., Özcan, E., & Qu, R. (2013). _Hyper-heuristics: A survey of the state of the art._ Journal of the Operational Research Society, 64(12), 1695–1724. [doi:10.1057/jors.2013.71](https://doi.org/10.1057/jors.2013.71)
10. AhmadiTeshnizi, A., Gao, W., Brunborg, H., Talaei, S., & Udell, M. (2024). _OptiMUS-0.3: Using large language models to model and solve optimization problems at scale._ arXiv:2407.19633. [arXiv:2407.19633](https://arxiv.org/abs/2407.19633)
11. Romera-Paredes, B., Barekatain, M., Novikov, A., et al. (2024). _Mathematical discoveries from program search with large language models (FunSearch)._ Nature, 625, 468–475. [doi:10.1038/s41586-023-06924-6](https://doi.org/10.1038/s41586-023-06924-6)
12. Havur, G., Cabanillas, C., & Polleres, A. (2022). _Benchmarking answer set programming systems for resource allocation in business processes._ Expert Systems with Applications, 205, 117599. [doi:10.1016/j.eswa.2022.117599](https://doi.org/10.1016/j.eswa.2022.117599)
13. Seppänen, O., et al. (2025). _Integrated forecasting approach for takt and location-based scheduling._ Journal of Construction Engineering and Management, 151(12), 04025199. [doi:10.1061/JCEMD4.COENG-16877](https://doi.org/10.1061/JCEMD4.COENG-16877)
