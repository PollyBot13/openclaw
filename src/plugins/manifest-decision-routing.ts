import { isDecisionTaskId, isDecisionTaskOwnedBy } from "../decisions/task-ids.js";
import { isRecord } from "../utils.js";
import type { PluginManifestDecisionRouter, PluginManifestDecisionTask } from "./manifest-types.js";

type Parsed<T> = { ok: true; value?: T } | { ok: false; error: string };

export function parseManifestDecisionTasks(
  raw: unknown,
  pluginId: string,
): Parsed<PluginManifestDecisionTask[]> {
  if (raw === undefined) {
    return { ok: true };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "decisionTasks must be an array" };
  }
  const seen = new Set<string>();
  const tasks: PluginManifestDecisionTask[] = [];
  for (const entry of raw) {
    if (
      !isRecord(entry) ||
      !isDecisionTaskId(entry.id) ||
      !isDecisionTaskOwnedBy(entry.id, pluginId) ||
      seen.has(entry.id) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 120 ||
      typeof entry.description !== "string" ||
      !entry.description.trim() ||
      entry.description.length > 400 ||
      entry.evaluationOnly !== undefined
    ) {
      return {
        ok: false,
        error: "decisionTasks must have unique plugin-owned IDs, names and descriptions",
      };
    }
    seen.add(entry.id);
    tasks.push({
      id: entry.id,
      name: entry.name.trim(),
      description: entry.description.trim(),
    });
  }
  return { ok: true, value: tasks };
}

export function parseManifestDecisionRouter(
  raw: unknown,
  configSchema: Record<string, unknown>,
): Parsed<PluginManifestDecisionRouter> {
  if (raw === undefined) {
    return { ok: true };
  }
  if (!isRecord(raw) || Object.keys(raw).length !== 1) {
    return { ok: false, error: "decisionRouter must declare only configMapProperty" };
  }
  const property = raw.configMapProperty;
  const properties = isRecord(configSchema.properties) ? configSchema.properties : undefined;
  const mapSchema = properties && typeof property === "string" ? properties[property] : undefined;
  if (
    typeof property !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(property) ||
    !isRecord(mapSchema) ||
    mapSchema.type !== "object" ||
    !isRecord(mapSchema.additionalProperties)
  ) {
    return {
      ok: false,
      error: "decisionRouter.configMapProperty must name an object map in configSchema",
    };
  }
  return { ok: true, value: { configMapProperty: property } };
}
