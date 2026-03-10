import { z } from "zod";

export const DateStringSchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), { message: "Invalid date string" })
  .transform((val) => new Date(val));

export const NullableDateStringSchema = z.nullable(z.string()).transform((val) => {
  if (val === null || val === "") {
    return null;
  }
  const parsed = new Date(val);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
});
