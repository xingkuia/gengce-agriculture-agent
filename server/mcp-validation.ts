export function validateToolArguments(schema: unknown, args: Record<string, unknown>): string | null {
  if (!schema || typeof schema !== "object") return null;
  return validateJsonValue(args, schema as Record<string, unknown>, "arguments");
}

function validateJsonValue(value: unknown, schema: Record<string, unknown> | boolean, path: string): string | null {
  if (schema === true) return null;
  if (schema === false) return `${path} 不允许传值`;
  if (schema.const !== undefined && value !== schema.const) return `${path} 与固定值不匹配`;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => item === value)) {
    return `${path} 不在允许值范围内`;
  }

  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    if (!Array.isArray(schema[key])) continue;
    const results = (schema[key] as unknown[]).map(item =>
      validateJsonValue(value, item as Record<string, unknown> | boolean, path)
    );
    if (key === "allOf" && results.some(Boolean)) return results.find(Boolean) ?? null;
    if (key === "anyOf" && !results.some(result => result === null)) return `${path} 不满足任一类型约束`;
    if (key === "oneOf" && results.filter(result => result === null).length !== 1) {
      return `${path} 必须只满足一种类型约束`;
    }
  }

  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) return `${path} 类型应为 ${type}`;
  if (Array.isArray(type) && !type.some(item => typeof item === "string" && matchesType(value, item))) {
    return `${path} 类型不匹配`;
  }
  if (value === null) return null;

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path} 长度过短`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path} 长度过长`;
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) return `${path} 格式不匹配`;
      } catch {
        // Invalid remote patterns are ignored rather than blocking an otherwise valid call.
      }
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${path} 小于最小值`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${path} 大于最大值`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path} 项数过少`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path} 项数过多`;
    if (schema.items && typeof schema.items === "object") {
      for (const [index, item] of value.entries()) {
        const issue = validateJsonValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`);
        if (issue) return issue;
      }
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties as Record<string, Record<string, unknown>>
      : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    const missing = required.find(key => !(key in object));
    if (missing) return `${path}.${missing} 为必填参数`;
    for (const [key, item] of Object.entries(object)) {
      const propertySchema = properties[key];
      if (!propertySchema) {
        if (schema.additionalProperties === false) return `${path}.${key} 不是允许的参数`;
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          const issue = validateJsonValue(
            item,
            schema.additionalProperties as Record<string, unknown>,
            `${path}.${key}`
          );
          if (issue) return issue;
        }
        continue;
      }
      const issue = validateJsonValue(item, propertySchema, `${path}.${key}`);
      if (issue) return issue;
    }
  }
  return null;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}
