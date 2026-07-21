import type { MongoSchemaField } from '@/api/types/mongodb'

const DEFAULT_REQUIRED_THRESHOLD = 0.9

interface SchemaPropertyNode {
  bsonType?: string | string[]
  properties?: Record<string, SchemaPropertyNode>
  required?: string[]
  description?: string
}

function primaryBsonType(field: MongoSchemaField): string | string[] {
  const types = field.typeBreakdown?.length
    ? [...field.typeBreakdown]
        .sort((a, b) => b.frequency - a.frequency)
        .map((item) => item.type)
    : field.types

  const normalized = [...new Set(types.map(mapBsonTypeName))]
  if (normalized.length === 1) return normalized[0]!
  return normalized
}

function mapBsonTypeName(type: string): string {
  switch (type) {
    case 'int':
    case 'long':
    case 'double':
    case 'decimal':
    case 'number':
      return 'number'
    case 'bool':
      return 'bool'
    case 'coordinates':
      return 'object'
    default:
      return type
  }
}

function ensureNode(
  root: SchemaPropertyNode,
  parts: string[],
): SchemaPropertyNode {
  let current = root
  for (const part of parts) {
    current.properties ??= {}
    current.properties[part] ??= { bsonType: 'object', properties: {} }
    current = current.properties[part]!
  }
  return current
}

/** 根据采样字段推断 MongoDB $jsonSchema 校验器草案。 */
export function buildMongoJsonSchema(
  fields: MongoSchemaField[],
  options?: { requiredThreshold?: number },
): Record<string, unknown> {
  const threshold = options?.requiredThreshold ?? DEFAULT_REQUIRED_THRESHOLD
  const root: SchemaPropertyNode = { bsonType: 'object', properties: {}, required: [] }
  const requiredTop = new Set<string>()

  const sorted = [...fields].sort((a, b) => a.path.localeCompare(b.path))
  for (const field of sorted) {
    const parts = field.path.split('.').filter(Boolean)
    if (parts.length === 0) continue

    const leaf = parts[parts.length - 1]!
    const parentParts = parts.slice(0, -1)
    const parent = parentParts.length > 0 ? ensureNode(root, parentParts) : root

    parent.properties ??= {}
    parent.properties[leaf] = {
      bsonType: primaryBsonType(field),
      description: `sampled presence ${Math.round(field.frequency * 100)}%`,
    }

    if (parts.length === 1 && field.frequency >= threshold) {
      requiredTop.add(parts[0]!)
    }
  }

  root.required = [...requiredTop].sort((a, b) => a.localeCompare(b))
  return {
    $jsonSchema: pruneEmptyProperties(root),
  }
}

function pruneEmptyProperties(node: SchemaPropertyNode): SchemaPropertyNode {
  const next: SchemaPropertyNode = { ...node }
  if (next.properties) {
    const properties: Record<string, SchemaPropertyNode> = {}
    for (const [key, child] of Object.entries(next.properties)) {
      properties[key] = pruneEmptyProperties(child)
    }
    next.properties = properties
  }
  if (next.required?.length === 0) {
    delete next.required
  }
  if (next.properties && Object.keys(next.properties).length === 0) {
    delete next.properties
  }
  return next
}

/** 格式化校验器 JSON 文本。 */
export function formatValidatorJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
