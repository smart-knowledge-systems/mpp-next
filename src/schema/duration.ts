import { z } from "zod";

import { Duration } from "../model/Duration.ts";
import { TimeUnitSchema } from "./types.ts";

export const DurationRawSchema = z.object({
  duration: z.number(),
  units: TimeUnitSchema,
});

export const DurationSchema = DurationRawSchema.transform((val) =>
  Duration.from(val.duration, val.units),
);

export const NullableDurationSchema = z
  .nullable(DurationRawSchema)
  .transform((val) => (val ? Duration.from(val.duration, val.units) : null));
