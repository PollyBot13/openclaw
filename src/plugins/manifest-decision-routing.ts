import { isRecord } from "../utils.js";
import type { PluginManifestDecisionRouter } from "./manifest-types.js";

type Parsed<T> = { ok: true; value?: T } | { ok: false; error: string };

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
