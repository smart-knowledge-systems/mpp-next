import { z } from "zod";
import { TimeUnit, RelationType, ResourceType, ConstraintType } from "../model/types.ts";

export const TimeUnitSchema = z.enum(TimeUnit);

export const RelationTypeSchema = z.enum(RelationType);

export const ResourceTypeSchema = z.enum(ResourceType);

export const ConstraintTypeSchema = z.enum(ConstraintType);
