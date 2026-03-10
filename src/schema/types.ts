import { z } from "zod";

export const TimeUnitSchema = z.enum(["minutes", "hours", "days", "weeks", "months", "percent"]);

export const RelationTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);

export const ResourceTypeSchema = z.enum(["Material", "Work", "Cost"]);

export const ConstraintTypeSchema = z.enum([
  "ASAP",
  "ALAP",
  "MSO",
  "MFO",
  "SNET",
  "SNLT",
  "FNET",
  "FNLT",
]);
