import { z } from "zod";
import {
  TimeUnit,
  RelationType,
  ResourceType,
  ConstraintType,
} from "../model/types.ts";

export const TimeUnitSchema = z.nativeEnum(TimeUnit);

export const RelationTypeSchema = z.nativeEnum(RelationType);

export const ResourceTypeSchema = z.nativeEnum(ResourceType);

export const ConstraintTypeSchema = z.nativeEnum(ConstraintType);
