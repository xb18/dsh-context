import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { AgentForest, AgentNode } from '../../src/client/agentTree'
import { atlasFlowsOf, atlasLayoutOf, atlasViewOf } from '../../src/client/atlasModel'
import { flowsOf } from '../../src/client/fleetActivity'
import type { CommsRow } from '../../src/client/fleetDetail'

function node(id: string, over: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    label: id,
    depth: 0,
    family: 0,
    isCurrent: id === 'root',
    running: false,
    completed: true,
    subagent: id !== 'root',
    updatedAt: 1,
    head: null,
    requests: 0,
    billed: null,
    costUsage: null,
    durationMs: null,
    identity: null,
    ...over,
  }
}

function largeForest(): AgentForest {
  const children = Array.from({ length: 24 }, (_, index) => node(`w${index}`, {
    parentId: 'root',
    depth: 1,
    running: index === 10,
    completed: index !== 10,
  }))
  return {
    nodes: [node('root', { running: true, completed: false }), ...children],
    edges: children.map(child => ({ from: 'root', to: child.id })),
    solo: false,
  }
}

describe('atlas model', () => {
  test('large sibling groups keep running and selected nodes and fold the remainder', () => {
    const forest = largeForest()
    const entries = atlasViewOf(forest, new Set(), false, 'w20')
    const cluster = entries.find(entry => entry.node === null)
    assert.equal(entries.filter(entry => entry.node !== null).length, 6)
    assert.equal(cluster?.hidden.length, 19)
    assert.ok(entries.some(entry => entry.id === 'w10'))
    assert.ok(entries.some(entry => entry.id === 'w20'))
    assert.ok(!entries.some(entry => entry.id === 'w3'))
    const expanded = atlasViewOf(forest, new Set(['root']), false, null)
    assert.equal(expanded.length, 25)
    assert.equal(atlasViewOf(forest, new Set(), true, null).length, 25)
    const allRunning = largeForest()
    for (const entry of allRunning.nodes) entry.running = true
    assert.equal(atlasViewOf(allRunning, new Set(), false, null).some(entry => entry.node === null), false)
    const layout = atlasLayoutOf(entries, 720, true)
    assert.ok(layout.controls.length < forest.edges.length)
    assert.ok(layout.points.some(point => point.node === null))
    assert.ok(layout.height > 160)
  })

  test('selected and running descendants keep their ancestor path visible', () => {
    const forest = largeForest()
    forest.nodes.push(node('deep', { parentId: 'w5', depth: 2, running: true, completed: false }))
    forest.edges.push({ from: 'w5', to: 'deep' })
    const selected = atlasViewOf(forest, new Set(), false, 'deep')
    assert.ok(selected.some(entry => entry.id === 'w5'))
    assert.ok(selected.some(entry => entry.id === 'deep'))
    const running = atlasViewOf(forest, new Set(), false, null)
    assert.ok(running.some(entry => entry.id === 'w5'))
    assert.ok(running.some(entry => entry.id === 'deep'))
    const links = atlasFlowsOf(atlasLayoutOf(selected, 900, true).points, flowsOf([
      { key: 'deep-message', to: 'w1', seq: 1, time: 1, kind: 'relay', from: 'deep', text: 'deep' },
    ]))
    assert.equal(links.length, 1)
    assert.equal(links[0].from.id, 'deep')
    forest.nodes.push(node('folded-deep', { parentId: 'w20', depth: 2 }))
    forest.edges.push({ from: 'w20', to: 'folded-deep' })
    const folded = atlasViewOf(forest, new Set(), false, null)
    const cluster = folded.find(entry => entry.node === null)
    assert.ok(cluster?.hidden.some(entry => entry.id === 'w20'))
    assert.ok(cluster?.hidden.some(entry => entry.id === 'folded-deep'))
    const foldedLinks = atlasFlowsOf(atlasLayoutOf(folded, 900, true).points, flowsOf([
      { key: 'folded-message', to: 'root', seq: 2, time: 2, kind: 'relay', from: 'folded-deep', text: 'folded' },
    ]))
    assert.equal(foldedLinks.length, 1)
    assert.equal(foldedLinks[0].from.id, 'cluster:root')
  })

  test('small forests, short sibling groups and detached roots stay complete', () => {
    const small: AgentForest = {
      nodes: [node('root'), node('a', { parentId: 'root', depth: 1 }), node('free')],
      edges: [{ from: 'root', to: 'a' }],
      solo: false,
    }
    assert.equal(atlasViewOf(small, new Set(), false, null).length, 3)
    const medium = largeForest()
    medium.nodes = medium.nodes.slice(0, 7)
    medium.edges = medium.edges.slice(0, 6)
    assert.equal(atlasViewOf(medium, new Set(), false, null).length, 7)
    const layout = atlasLayoutOf(atlasViewOf(small, new Set(), false, null), 0, false)
    assert.equal(layout.points.length, 3)
    assert.equal(layout.controls.length, 1)
    assert.ok(layout.points.every(point => point.width > 0))
    assert.ok(atlasLayoutOf([], 300, false).height >= 160)
    const orphan = atlasLayoutOf([{ id: 'orphan', parentId: 'missing', depth: 1, node: node('orphan'), hidden: [] }], 300, false)
    assert.equal(orphan.controls.length, 0)
    const narrow = atlasLayoutOf(atlasViewOf(small, new Set(), false, null), 265, false)
    assert.equal(narrow.width, 265)
    assert.ok(narrow.points.every(point => point.x >= 0 && point.x + point.width <= narrow.width))
  })

  test('flow links only connect distinct visible endpoints', () => {
    const forest = largeForest()
    const points = atlasLayoutOf(atlasViewOf(forest, new Set(), true, null), 900, false).points
    const rows: CommsRow[] = [
      { key: 'one', to: 'w1', seq: 1, time: 1, kind: 'relay', from: 'root', text: 'one' },
      { key: 'self', to: 'root', seq: 2, time: 2, kind: 'relay', from: 'root', text: 'self' },
      { key: 'missing', to: 'outside', seq: 3, time: 3, kind: 'relay', from: 'root', text: 'missing' },
    ]
    const links = atlasFlowsOf(points, flowsOf(rows))
    assert.equal(links.length, 1)
    assert.equal(links[0].from.id, 'root')
    assert.equal(links[0].to.id, 'w1')
    const collapsed = atlasLayoutOf(atlasViewOf(forest, new Set(), false, null), 900, false).points
    const hiddenRows: CommsRow[] = [{ key: 'hidden', to: 'w20', seq: 4, time: 4, kind: 'relay', from: 'root', text: 'hidden' }]
    const aggregated = atlasFlowsOf(collapsed, flowsOf(hiddenRows))
    assert.equal(aggregated.length, 1)
    assert.equal(aggregated[0].to.node, null)
    assert.equal(aggregated[0].to.id, 'cluster:root')
  })
})
