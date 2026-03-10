export interface FieldMapEntry {
  fieldId: number;
  property: string;
  source: "fixed" | "variable";
}

// Seed mapping for the fixture-backed decoder. The binary decoder can extend this
// incrementally as field IDs are confirmed from MPXJ source and sample files.
export const FIELD_MAP: FieldMapEntry[] = [
  { fieldId: 1, property: "id", source: "fixed" },
  { fieldId: 2, property: "uniqueId", source: "fixed" },
  { fieldId: 3, property: "name", source: "variable" },
  { fieldId: 4, property: "wbs", source: "variable" },
  { fieldId: 5, property: "start", source: "fixed" },
  { fieldId: 6, property: "finish", source: "fixed" },
];
