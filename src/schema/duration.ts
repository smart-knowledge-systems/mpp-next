import { z } from "zod";

import { Duration } from "../model/Duration.ts";
import type { TimeUnit } from "../model/types.ts";
import { TimeUnitSchema } from "./types.ts";

export const DurationRawSchema = z.object({
  duration: z.number(),
  units: TimeUnitSchema,
});

export const DurationSchema = DurationRawSchema.transform((val) =>
  Duration.from(val.duration, val.units as TimeUnit),
);

export const NullableDurationSchema = z
  .nullable(DurationRawSchema)
  .transform((val) => (val ? Duration.from(val.duration, val.units as TimeUnit) : null));
