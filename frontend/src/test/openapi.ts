// test support: look up operations and schemas in the backend's openapi
// document, so the studio's snippets and explorer templates can be checked
// against the contract. only imported by tests.
import { openapiDocument } from '../../../backend/src/api/openapi';

export type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  additionalProperties?: boolean | Schema;
};

type Parameter = { name?: string; in?: string; $ref?: string };
type Operation = {
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

const doc = openapiDocument as unknown as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters?: Record<string, Parameter> };
};

function deref<T extends { $ref?: string }>(value: T): T {
  if (!value.$ref) return value;
  const [, , kind, name] = value.$ref.split('/');
  const target = (doc.components as unknown as Record<string, Record<string, T>>)[kind]?.[name];
  if (!target) throw new Error(`unresolved ${value.$ref}`);
  return deref(target);
}

/** A schema with refs followed and allOf merged; oneOf and anyOf stay as alternatives. */
export function resolveSchema(schema: Schema): Schema {
  const s = deref(schema);
  if (!s.allOf) return s;
  const parts = s.allOf.map(resolveSchema);
  return {
    type: 'object',
    properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
  };
}

/** The documented operation for a method and a concrete path, if there is one. */
export function findOperation(method: string, rawPath: string): Operation | undefined {
  const path = rawPath.split('?')[0].replace(/\/YOUR_[A-Z_]+/g, '/{id}');
  for (const [template, ops] of Object.entries(doc.paths)) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    const op = ops[method.toLowerCase()];
    if (op && pattern.test(path)) return op;
  }
  return undefined;
}

/** Query parameter names an operation documents. */
export function queryParams(op: Operation): Set<string> {
  return new Set(
    (op.parameters ?? [])
      .map(deref)
      .filter((p) => p.in === 'query')
      .map((p) => p.name!),
  );
}

export function requestSchema(op: Operation): Schema | undefined {
  return op.requestBody?.content?.['application/json']?.schema;
}

/** The json schema of the operation's success answer (the lowest 2xx). */
export function responseSchema(op: Operation): Schema | undefined {
  const code = Object.keys(op.responses ?? {})
    .filter((c) => c.startsWith('2'))
    .sort()[0];
  return code ? op.responses![code].content?.['application/json']?.schema : undefined;
}

function alternatives(schema: Schema): Schema[] {
  const s = resolveSchema(schema);
  const alts = s.oneOf ?? s.anyOf;
  return alts ? alts.flatMap(alternatives) : [s];
}

/** Problems with a json value as a request body for `schema`; empty when it fits. */
export function checkValue(value: unknown, schema: Schema, at = 'body'): string[] {
  const options = alternatives(schema);
  const results = options.map((s) => checkOne(value, s, at));
  return results.find((r) => r.length === 0) ?? results[0];
}

function checkOne(value: unknown, s: Schema, at: string): string[] {
  if (s.enum && !s.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} not in enum`];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  const actual =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : Number.isInteger(value)
          ? 'integer'
          : typeof value;
  if (
    types.length &&
    !types.includes(actual) &&
    !(actual === 'integer' && types.includes('number'))
  ) {
    return [`${at}: ${actual} where the schema wants ${types.join(' or ')}`];
  }
  if (actual === 'array' && s.items) {
    return (value as unknown[]).flatMap((v, i) => checkValue(v, s.items!, `${at}[${i}]`));
  }
  if (actual === 'object' && s.properties) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      s.properties![k]
        ? checkValue(v, s.properties![k], `${at}.${k}`)
        : [`${at}.${k}: not documented`],
    );
  }
  return [];
}

/** The schema of a property, looked up across alternatives; undefined when none has it. */
export function propertySchema(schema: Schema, name: string): Schema | undefined {
  for (const s of alternatives(schema)) {
    if (s.properties?.[name]) return s.properties[name];
  }
  return undefined;
}

/** The item schema of an array schema, if it is one. */
export function itemSchema(schema: Schema): Schema | undefined {
  for (const s of alternatives(schema)) if (s.items) return s.items;
  return undefined;
}
