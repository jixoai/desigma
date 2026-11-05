// Supports the November 2026 Document API and the earlier Navigator implementation.
// The fallback stays under window.desigma; it never pretends to be a browser API.
export function validate(schema, value, path = 'arguments') {
  if (!schema) return;
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) throw new TypeError(`${path}: unsupported value`);
  const type = schema.type;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
    for (const key of schema.required || []) if (!(key in value)) throw new TypeError(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (!property && schema.additionalProperties === false) throw new TypeError(`${path}.${key} is not supported`);
      validate(property, item, `${path}.${key}`);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new RangeError(`${path}: array length out of range`);
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
  } else if (type === 'string') {
    if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new RangeError(`${path}: string length out of range`);
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  } else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) throw new TypeError(`${path} must be a finite ${type}`);
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new RangeError(`${path}: number out of range`);
    if (schema.multipleOf && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) throw new RangeError(`${path}: invalid step`);
  }
}

export async function registerTools({ tools, execute, documentObject = document, navigatorObject = navigator }) {
  const controller = new AbortController();
  const context = documentObject.modelContext ?? navigatorObject.modelContext;
  const mode = documentObject.modelContext ? 'document' : navigatorObject.modelContext ? 'navigator' : 'javascript';
  const owned = [];
  let queue = Promise.resolve();
  let active = true;
  const catalog = new Map(tools.map(tool => [tool.name, tool]));
  const call = (name, args = {}, { signal } = {}) => {
    if (!active) return Promise.reject(new Error('Tool registration has been closed'));
    const definition = catalog.get(name);
    if (!definition) return Promise.reject(new Error(`Unknown tool: ${name}`));
    let input;
    try {
      // Snapshot input now so a caller cannot mutate queued work after validation.
      input = structuredClone(args);
      validate(definition.inputSchema, input);
      signal?.throwIfAborted();
    } catch (error) { return Promise.reject(error); }
    const run = queue.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      if (!active) throw new Error('Tool registration has been closed');
      // Give browser input and paint a turn between successive agent operations.
      if (globalThis.scheduler?.yield) await scheduler.yield();
      else await new Promise(resolve => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      return execute(name, input, { signal, definition });
    });
    queue = run;
    return run;
  };
  try {
    if (context?.registerTool) {
      for (const definition of tools) {
        await context.registerTool({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: {
            readOnlyHint: !!definition.annotations?.readOnlyHint,
            untrustedContentHint: true,
            consequentialHint: !!definition.annotations?.consequentialHint,
          },
          execute: (args, options) => call(definition.name, args, options),
        }, { signal: controller.signal });
        owned.push(definition.name);
      }
    }
  } catch (error) {
    controller.abort();
    for (const name of owned) { try { context.unregisterTool?.(name); } catch {} }
    throw error;
  }
  return Object.freeze({
    mode,
    tools: () => structuredClone(tools),
    call,
    dispose() {
      active = false;
      controller.abort();
      if (mode === 'navigator') for (const name of owned) context?.unregisterTool?.(name);
    },
  });
}
