import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../src/openapi.ts';

// 05 §1 ("Lint/test asserts no API contract has lat/lng fields from the device") — Phase 07 security review M1. The
// musalli app's location (Qibla, prayer times) stays on the phone, so no request a phone can send to the public API
// (`/api/v1/…`: path, query, header parameters and bodies, push subscriptions included) may have a field that could carry
// it. The OpenAPI document is generated from every `defineRoute` and kept current by `openapi.test.ts`.

const LOCATION_KEY = /^(lat|lng|lon|long|latitude|longitude|coords?|coordinates|location|position|accuracy|geo)$/iu;
const PUBLIC_PREFIX = '/api/v1/';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every property name reachable from `node`, following `$ref`s into `components` (each component once). */
function propertyNames(
  node: Json | undefined,
  components: { [key: string]: Json },
  seen = new Set<string>(),
): string[] {
  if (Array.isArray(node)) return node.flatMap((entry) => propertyNames(entry, components, seen));
  if (!isObject(node)) return [];
  const names: string[] = [];
  const ref = node['$ref'];
  if (typeof ref === 'string' && !seen.has(ref)) {
    seen.add(ref);
    const target = ref
      .replace(/^#\/components\//u, '')
      .split('/')
      .reduce<Json | undefined>((at, part) => (isObject(at) ? at[part] : undefined), components);
    names.push(...propertyNames(target, components, seen));
  }
  const properties = node['properties'];
  if (isObject(properties)) names.push(...Object.keys(properties));
  for (const [key, value] of Object.entries(node)) {
    if (key !== '$ref') names.push(...propertyNames(value, components, seen));
  }
  return names;
}

/** The request side of every public operation: `"METHOD /path" → field names`. */
function publicRequestFields(): Map<string, string[]> {
  const document = JSON.parse(JSON.stringify(buildOpenApiDocument())) as { [key: string]: Json }; // plain JSON tree
  const components = isObject(document['components']) ? document['components'] : {};
  const paths = isObject(document['paths']) ? document['paths'] : {};
  const fields = new Map<string, string[]>();
  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith(PUBLIC_PREFIX) || !isObject(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!isObject(operation)) continue;
      const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
      const names = parameters.flatMap((parameter) =>
        isObject(parameter) && typeof parameter['name'] === 'string' ? [parameter['name']] : [],
      );
      names.push(...propertyNames(operation['requestBody'], components));
      fields.set(`${method.toUpperCase()} ${path}`, names);
    }
  }
  return fields;
}

describe('no device location in any public request (05 §1)', () => {
  it('covers the device routes (the walk reaches request bodies)', () => {
    const fields = publicRequestFields();
    expect(fields.size).toBeGreaterThan(10);
    expect(fields.get('POST /api/v1/devices')).toEqual(expect.arrayContaining(['locale', 'audiencePref']));
  });

  it('has no field that could carry coordinates', () => {
    const offending = [...publicRequestFields()].flatMap(([operation, names]) =>
      names.filter((name) => LOCATION_KEY.test(name)).map((name) => `${operation}: ${name}`),
    );
    expect(offending).toEqual([]);
  });
});
