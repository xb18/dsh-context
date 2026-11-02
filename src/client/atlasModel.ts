import type { AgentForest, AgentNode } from './agentTree'
import type { FleetFlow } from './fleetActivity'

export type AtlasEntry = {
  id: string
  parentId?: string
  depth: number
  node: AgentNode
  hidden: AgentNode[]
} | {
  id: string
  parentId: string
  depth: number
  node: null
  hidden: AgentNode[]
}

export type AtlasPoint = AtlasEntry & {
  x: number
  y: number
  width: number
  height: number
}

export interface AtlasControlLink {
  key: string
  from: AtlasPoint
  to: AtlasPoint
}

export interface AtlasFlowLink {
  flow: FleetFlow
  from: AtlasPoint
  to: AtlasPoint
}

export interface AtlasLayout {
  width: number
  height: number
  points: AtlasPoint[]
  controls: AtlasControlLink[]
  flows: AtlasFlowLink[]
}

export function atlasViewOf(
  forest: AgentForest,
  expanded: ReadonlySet<string>,
  showAll: boolean,
  selectedId: string | null,
): AtlasEntry[] {
  const byId = new Map(forest.nodes.map(node => [node.id, node]))
  const children = new Map<string, AgentNode[]>()
  const roots: AgentNode[] = []
  for (const node of forest.nodes) {
    if (node.parentId === undefined || !byId.has(node.parentId)) {
      roots.push(node)
      continue
    }
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const entries: AtlasEntry[] = []
  const keepSubtree = (node: AgentNode): boolean => {
    if (node.running || node.id === selectedId) return true
    return (children.get(node.id) ?? []).some(child => keepSubtree(child))
  }
  const flatten = (node: AgentNode): AgentNode[] => [node, ...(children.get(node.id) ?? []).flatMap(child => flatten(child))]
  const visit = (node: AgentNode): void => {
    entries.push({ id: node.id, parentId: node.parentId, depth: node.depth, node, hidden: [] })
    const kids = children.get(node.id) ?? []
    const collapsible = !showAll && forest.nodes.length > 18 && kids.length > 6 && !expanded.has(node.id)
    if (!collapsible) {
      for (const kid of kids) visit(kid)
      return
    }
    const kept = kids.filter((kid, index) => index < 3 || keepSubtree(kid))
    const keptIds = new Set(kept.map(kid => kid.id))
    const hidden = kids.filter(kid => !keptIds.has(kid.id)).flatMap(kid => flatten(kid))
    for (const kid of kept) visit(kid)
    if (hidden.length > 0) entries.push({ id: `cluster:${node.id}`, parentId: node.id, depth: node.depth + 1, node: null, hidden })
  }
  for (const root of roots) visit(root)
  return entries
}

export function atlasLayoutOf(entries: readonly AtlasEntry[], stageWidth: number, compact: boolean): Omit<AtlasLayout, 'flows'> {
  const width = Math.max(1, stageWidth || 960)
  const available = Math.max(0, width - 20)
  const gap = compact ? 8 : 12
  const basis = compact ? 136 : 164
  const columns = Math.max(1, Math.floor((available + gap) / (basis + gap)))
  const cardWidth = Math.max(0, Math.min(220, (available - (columns - 1) * gap) / columns))
  const cardHeight = compact ? 50 : 64
  const groups = new Map<number, AtlasEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.depth) ?? []
    group.push(entry)
    groups.set(entry.depth, group)
  }
  const points: AtlasPoint[] = []
  let y = 12
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    for (let start = 0; start < group.length; start += columns) {
      const row = group.slice(start, start + columns)
      const rowWidth = row.length * cardWidth + (row.length - 1) * gap
      const left = (width - rowWidth) / 2
      row.forEach((entry, index) => {
        points.push({ ...entry, x: left + index * (cardWidth + gap), y, width: cardWidth, height: cardHeight })
      })
      y += cardHeight + (compact ? 10 : 14)
    }
    y += compact ? 20 : 30
  }
  const byId = new Map(points.map(point => [point.id, point]))
  const controls: AtlasControlLink[] = []
  for (const point of points) {
    if (point.parentId === undefined) continue
    const from = byId.get(point.parentId)
    if (from !== undefined) controls.push({ key: `${from.id}:${point.id}`, from, to: point })
  }
  return { width, height: Math.max(160, y + 4), points, controls }
}

export function atlasFlowsOf(points: readonly AtlasPoint[], flows: readonly FleetFlow[]): AtlasFlowLink[] {
  const byId = new Map(points.map(point => [point.id, point]))
  const clusterOf = new Map<string, AtlasPoint>()
  for (const point of points) {
    if (point.node !== null) continue
    for (const hidden of point.hidden) clusterOf.set(hidden.id, point)
  }
  const links: AtlasFlowLink[] = []
  for (const flow of flows) {
    const from = byId.get(flow.from) ?? clusterOf.get(flow.from)
    const to = byId.get(flow.to) ?? clusterOf.get(flow.to)
    if (from !== undefined && to !== undefined && from.id !== to.id) links.push({ flow, from, to })
  }
  return links
}
