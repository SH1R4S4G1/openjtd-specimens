// Dependency-free evaluator for the JSON Schema vocabulary used by our contract.
// This is deliberately not a general JSON Schema implementation. Fail closed
// if the contract starts using a keyword that this evaluator does not support.
const keywords = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'const', 'enum', 'oneOf', 'properties', 'required', 'additionalProperties',
  'minProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength',
  'maxLength', 'pattern', 'minimum', 'maximum']);

export function assertSupportedSchema(schema) {
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  }
  for (const map of [schema.$defs, schema.properties]) {
    for (const child of Object.values(map ?? {})) assertSupportedSchema(child);
  }
  for (const child of schema.oneOf ?? []) assertSupportedSchema(child);
  if (schema.items) assertSupportedSchema(schema.items);
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new Error('Only closed object schemas are supported.');
  }
}

export function validateSchema(value, schema, root = schema, location = '$') {
  const fail = message => { throw Object.assign(new Error(`${location}: ${message}`),
    {code: 'ERR_SAMPLE_SCHEMA', path: location}); };
  if (schema.$ref) {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(schema.$ref);
    if (!match || !Object.hasOwn(root.$defs ?? {}, match[1])) fail('unresolved schema reference');
    validateSchema(value, root.$defs[match[1]], root, location);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(branch => {
      try { validateSchema(value, branch, root, location); return true; } catch { return false; }
    });
    if (matches.length !== 1) fail('must match exactly one supported structure (check kind/capability, required fields, unknown fields and parameter bounds)');
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (Object.hasOwn(schema, 'const') && !same(value, schema.const)) fail(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(item => same(value, item))) fail(`must be one of ${schema.enum.join(', ')}`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const isType = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : typeof value === type;
  if (types.length && !types.some(isType)) fail(`must have type ${types.join(' or ')}`);
  if (typeof value === 'string') {
    const length = [...value].length; // JSON Schema lengths count Unicode code points.
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) fail('string length outside supported bounds');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('string does not match required pattern');
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail('number outside supported bounds');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail('array length outside supported bounds');
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail('items must be unique');
    if (schema.items) for (let i = 0; i < value.length; i++) validateSchema(value[i], schema.items, root, `${location}[${i}]`);
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing required field ${key}`);
    if (Object.keys(value).length < (schema.minProperties ?? 0)) fail('object must not be empty');
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validateSchema(child, schema.properties[key], root, `${location}.${key}`);
      else if (schema.additionalProperties === false) fail(`unknown field ${key}`);
    }
  }
}

// Node API accepts JSON data only, without invoking accessors or toJSON hooks.
export function assertJsonData(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('Catalog must be finite, acyclic JSON data.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Catalog must contain plain JSON records.');
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Catalog must contain JSON data properties.');
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) throw new Error('Invalid JSON array property.');
    assertJsonData(descriptor.value, seen);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('Sparse JSON arrays are not supported.');
  seen.delete(value);
}
