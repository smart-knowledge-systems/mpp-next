// First concrete Block (Pillar 3 / §4.2). The greedy serial-SGS already honors
// the `MaxConcurrentResource` constraint variant, so this Block is what the
// LCNC palette and the LLM agent will emit when a user asks for a per-resource
// concurrency cap. The MiniZinc fragment targets the v1 compile shape from
// docs/dev-log/leveling-toolkit-spec-v3.md (§4.2): `active[t,d]` is the
// boolean activity matrix and `DAYS` is the day index set.

import { z } from "zod";

import type { Block } from "../types.ts";

export const MaxConcurrentResourceSchema = z.object({
  resourceUniqueId: z.number().int(),
  max: z.number().int().positive(),
});

export type MaxConcurrentResourceParams = z.infer<typeof MaxConcurrentResourceSchema>;

export const MaxConcurrentResourceBlock: Block<MaxConcurrentResourceParams> = {
  name: "MaxConcurrentResource",
  schema: MaxConcurrentResourceSchema,
  doc: "At most N units may simultaneously demand the named resource on any working day.",
  apply: (_project, params) => [
    {
      kind: "MaxConcurrentResource",
      resourceUniqueId: params.resourceUniqueId,
      max: params.max,
    },
  ],
  toMiniZinc: (params, ctx) => {
    const tasks = ctx.tasksDemanding(params.resourceUniqueId);
    const taskSet = tasks.length > 0 ? `{${tasks.join(",")}}` : "{}";
    return `constraint forall(d in DAYS) ( sum(t in ${taskSet}) (bool2int(active[t,d])) <= ${String(params.max)} );`;
  },
};
