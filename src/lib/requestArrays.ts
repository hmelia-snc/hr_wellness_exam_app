// A single checked checkbox posts its `name` as one string; more than one
// posts an array — express/qs only produces an array once there's more
// than one value for the same key.
export function toIdArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}
