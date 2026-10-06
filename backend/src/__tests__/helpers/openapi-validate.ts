/**
 * Checks real responses against the OpenAPI document: the status code must be
 * documented for the operation, and a JSON body must match the documented
 * schema. OpenAPI 3.1 schemas are JSON Schema 2020-12, so ajv validates them
 * directly; the whole document is registered once so `#/components/...`
 * references resolve.
 */
import { expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { openapiDocument } from '../../api/openapi.js';

// ajv-formats is CommonJS; depending on the interop the plugin is the module
// itself or its `default`
type FormatsPlugin = (ajv: Ajv2020) => Ajv2020;
const formatsModule = addFormatsModule as unknown as FormatsPlugin & { default?: FormatsPlugin };
const addFormats: FormatsPlugin = formatsModule.default ?? formatsModule;

const DOC_ID = 'openapi';

type Responses = Record<string, { $ref?: string; content?: Record<string, { schema?: unknown }> }>;

function pointer(...segments: string[]): string {
  return segments
    .map((s) => encodeURIComponent(s.replace(/~/g, '~0').replace(/\//g, '~1')))
    .join('/');
}

export interface ResponseLike {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  text?: string;
}

export function createSpecChecker() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(JSON.parse(JSON.stringify(openapiDocument)), DOC_ID);

  /** Every operation a test checked, as `METHOD /path/{template}`. */
  const seen = new Set<string>();

  function check(method: string, template: string, res: ResponseLike): void {
    const m = method.toLowerCase();
    const item = (openapiDocument.paths as Record<string, Record<string, unknown>>)[template];
    expect(item, `${template} is not in the OpenAPI document`).toBeDefined();
    const op = item[m] as { responses: Responses } | undefined;
    expect(op, `${method.toUpperCase()} ${template} is not in the OpenAPI document`).toBeDefined();
    seen.add(`${method.toUpperCase()} ${template}`);

    const status = String(res.status);
    const documented = op!.responses[status];
    expect(
      documented,
      `${method.toUpperCase()} ${template} answered ${status}, which the document does not list ` +
        `(body: ${JSON.stringify(res.body ?? res.text).slice(0, 300)})`,
    ).toBeDefined();

    const contentType = res.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) return;

    let base: string;
    let response = documented!;
    if (documented!.$ref) {
      const name = documented!.$ref.split('/').pop()!;
      base = `#/${pointer('components', 'responses', name)}`;
      response = (openapiDocument.components as unknown as { responses: Responses }).responses[
        name
      ];
    } else {
      base = `#/${pointer('paths', template, m, 'responses', status)}`;
    }
    const schema = response?.content?.['application/json']?.schema;
    expect(
      schema,
      `${method.toUpperCase()} ${template} ${status} sends JSON but documents no schema`,
    ).toBeDefined();

    const ref = `${DOC_ID}${base}/${pointer('content', 'application/json', 'schema')}`;
    const validate = ajv.getSchema(ref);
    expect(validate, `could not resolve ${ref}`).toBeDefined();
    const ok = validate!(res.body);
    expect(
      ok,
      `${method.toUpperCase()} ${template} ${status} does not match its schema: ` +
        `${ajv.errorsText(validate!.errors)}\nbody: ${JSON.stringify(res.body).slice(0, 500)}`,
    ).toBe(true);
  }

  return { check, seen };
}

/** Every operation in the document, as `METHOD /path/{template}`. */
export function documentedOperations(): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(openapiDocument.paths)) {
    for (const method of Object.keys(item)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) {
        out.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return out;
}
