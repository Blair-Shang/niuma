import type { MongoSchemaField } from '@/api/types/mongodb'
import type { RsTreeNode } from '@niuma/ui'

export interface SchemaTreeNode extends RsTreeNode {
  key: string
  label: string
  path: string
  field?: MongoSchemaField
  children?: SchemaTreeNode[]
}

/** 将扁平字段路径构建为嵌套树（Compass 风格）。 */
export function buildSchemaTree(fields: MongoSchemaField[]): SchemaTreeNode[] {
  const fieldMap = new Map(fields.map((field) => [field.path, field]))
  const nodeMap = new Map<string, SchemaTreeNode>()
  const roots: SchemaTreeNode[] = []

  const sorted = [...fields].sort((a, b) => a.path.localeCompare(b.path))
  for (const field of sorted) {
    const parts = field.path.split('.')
    let parentPath = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const path = parentPath ? `${parentPath}.${part}` : part
      let node = nodeMap.get(path)
      if (!node) {
        node = {
          key: path,
          label: part,
          path,
          field: fieldMap.get(path),
          children: [],
        }
        nodeMap.set(path, node)
        if (parentPath) {
          const parent = nodeMap.get(parentPath)
          parent?.children?.push(node)
        } else {
          roots.push(node)
        }
      }
      parentPath = path
    }
    const leaf = nodeMap.get(field.path)
    if (leaf) leaf.field = field
  }

  pruneEmptyChildren(roots)
  return roots
}

function pruneEmptyChildren(nodes: SchemaTreeNode[]): void {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      pruneEmptyChildren(node.children)
    } else {
      delete node.children
    }
  }
}

export function flattenSchemaTreeKeys(nodes: SchemaTreeNode[]): string[] {
  const keys: string[] = []
  const walk = (items: SchemaTreeNode[]) => {
    for (const item of items) {
      keys.push(item.key)
      if (item.children?.length) walk(item.children)
    }
  }
  walk(nodes)
  return keys
}

export function findSchemaTreeNode(nodes: SchemaTreeNode[], path: string): SchemaTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children?.length) {
      const found = findSchemaTreeNode(node.children, path)
      if (found) return found
    }
  }
  return null
}
