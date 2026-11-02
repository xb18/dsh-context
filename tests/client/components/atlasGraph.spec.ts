import { act, createElement as h } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AtlasGraph, type AtlasGraphProps } from '../../../src/client/components/atlasGraph'
import type { AgentForest, AgentNode } from '../../../src/client/agentTree'
import type { CommsRow } from '../../../src/client/fleetDetail'
import type { CommsAgent } from '../../../src/client/commsModel'
import { blur, click, focus, hover, keydown, makeKit, mount, query, queryAll, text, typeText, unhover } from '../helpers/kit'

const kit = makeKit()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function node(id: string, over: Partial<AgentNode> = {}): AgentNode {
  return {
    id, label: id, depth: id === 'root' ? 0 : 1, family: 0, isCurrent: id === 'root', running: false, completed: false,
    subagent: id !== 'root', updatedAt: 1, head: null, requests: 0, billed: null, costUsage: null, durationMs: null, identity: null,
    parentId: id === 'root' ? undefined : 'root', ...over,
  }
}

function agentsOf(forest: AgentForest): Map<string, CommsAgent> {
  return new Map(forest.nodes.map((entry, index) => [entry.id, {
    id: entry.id,
    name: entry.id === 'root' ? 'Lead' : entry.id === 'w1' ? 'worker-bee' : entry.id === 'w2' ? 'side-quest' : entry.label,
    role: entry.id === 'root' ? 'lead' : 'subagent',
    self: entry.isCurrent,
    hue: `hsl(${index * 40} 50% 50%)`,
    ...(entry.id === 'w2' ? { description: 'independent duty' } : {}),
  }]))
}

function propsOf(forest: AgentForest, comms: CommsRow[] = [], over: Partial<AtlasGraphProps> = {}): AtlasGraphProps {
  return {
    forest,
    team: null,
    comms,
    agents: agentsOf(forest),
    titles: new Map(),
    attested: new Map(),
    selectedId: null,
    hoverId: null,
    focusId: null,
    flowKey: null,
    onSelect: () => {},
    onHover: () => {},
    onFlow: () => {},
    t: kit.t,
    ...over,
  }
}

function smallForest(): AgentForest {
  return {
    nodes: [
      node('root', { running: true }),
      node('w1', { running: true, identity: { mode: 'continuable' } }),
      node('w2', { completed: true, durationMs: 9000, family: 1 }),
    ],
    edges: [{ from: 'root', to: 'w1' }, { from: 'root', to: 'w2' }],
    solo: false,
  }
}

const COMMS: CommsRow[] = [
  { key: 'one', to: 'w1', seq: 1, time: 1000, kind: 'relay', from: 'root', text: 'start' },
  { key: 'two', to: 'root', seq: 2, time: 2000, kind: 'settled', from: 'w1', text: 'settled' },
  { key: 'self', to: 'root', seq: 3, time: 3000, kind: 'relay', from: 'root', text: 'self' },
  { key: 'missing', to: 'missing', seq: 4, time: 4000, kind: 'mailbox', from: 'root', text: 'missing' },
]

describe('AtlasGraph', () => {
  test('nodes, keyboard, search, traffic edges and density are interactive', async () => {
    const forest = smallForest()
    const team = {
      members: [
        { id: 'root', name: 'lead', role: 'lead' as const, phase: 'active' as const },
        { id: 'w1', name: 'worker-bee', role: 'teammate' as const, phase: 'active' as const },
      ],
      tasks: [
        { id: 'done', subject: 'done', description: '', status: 'completed' as const, ownerName: 'worker-bee', blockedBy: [], writeScopes: [], ready: true, warnings: [] },
        { id: 'next', subject: 'next', description: '', status: 'pending' as const, ownerName: 'worker-bee', blockedBy: [], writeScopes: [], ready: true, warnings: [] },
      ],
    }
    const onSelect = vi.fn()
    const onHover = vi.fn()
    const onFlow = vi.fn()
    const mounted = await mount(h(AtlasGraph, propsOf(forest, COMMS, { team, onSelect, onHover, onFlow })))
    assert.equal(queryAll(mounted.container, '.lc-atlas-control-link').length, 2)
    assert.equal(queryAll(mounted.container, '.lc-atlas-flow-hit').length, 2)
    assert.ok(text(query(mounted.container, '[data-agent="w1"]')).includes('1/2'))
    assert.ok(text(query(mounted.container, '[data-agent="w2"]')).includes('9s'))
    const worker = query(mounted.container, '[data-agent="w1"]')
    await hover(worker)
    await unhover(worker)
    await focus(worker)
    await blur(worker)
    assert.deepEqual(onHover.mock.calls, [['w1'], [null], ['w1'], [null]])
    await click(worker)
    await keydown('Enter', query(mounted.container, '[data-agent="w2"]'))
    await keydown(' ', query(mounted.container, '[data-agent="root"]'))
    await keydown('x', worker)
    assert.deepEqual(onSelect.mock.calls, [['w1'], ['w2'], ['root']])
    const edge = query<SVGPathElement>(mounted.container, '.lc-atlas-flow-hit')
    await act(async () => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    await act(async () => { edge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })) })
    await act(async () => { edge.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })) })
    assert.equal(onFlow.mock.calls.length, 3)
    const search = query<HTMLInputElement>(mounted.container, '.lc-atlas-graph-tools .lc-fleet-search')
    await typeText(search, 'zzz')
    await keydown('Enter', search)
    await keydown('x', search)
    assert.equal(onSelect.mock.calls.length, 3)
    await typeText(search, 'independent')
    assert.ok(query(mounted.container, '[data-agent="root"]').className.includes('lc-atlas-node-dim'))
    await keydown('Enter', search)
    assert.deepEqual(onSelect.mock.calls.at(-1), ['w2'])
    await mounted.update(h(AtlasGraph, propsOf(forest, COMMS, { team, onSelect, onHover, onFlow, selectedId: 'w2', focusId: 'w1', flowKey: 'root\u0000w1' })))
    const selectionsBeforeRepeat = onSelect.mock.calls.length
    await keydown('Enter', search)
    assert.equal(onSelect.mock.calls.length, selectionsBeforeRepeat)
    assert.ok(query(mounted.container, '[data-agent="w2"]').className.includes('lc-atlas-node-selected'))
    assert.ok(query(mounted.container, '[data-agent="w1"]').className.includes('lc-atlas-node-hover'))
    assert.equal(queryAll(mounted.container, '.lc-atlas-flow-dim').length, 1)
    const selectedEdge = queryAll<SVGPathElement>(mounted.container, '.lc-atlas-flow-hit').find(edge => edge.getAttribute('aria-pressed') === 'true')!
    await act(async () => { selectedEdge.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { selectedEdge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    assert.deepEqual(onFlow.mock.calls.slice(-2), [[null], [null]])
    await typeText(search, '')
    await mounted.update(h(AtlasGraph, propsOf(forest, COMMS, { team, onSelect, onHover, onFlow, selectedId: 'root' })))
    assert.ok(!query(mounted.container, '[data-agent="w1"]').className.includes('lc-atlas-node-dim'))
    await mounted.update(h(AtlasGraph, propsOf(forest, COMMS, { team, onSelect, onHover, onFlow, selectedId: 'missing' })))
    await click(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn'))
    assert.ok(text(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn')).includes(kit.t('fleet.atlas.comfort')))
    await click(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn'))
    assert.ok(text(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn')).includes(kit.t('fleet.atlas.compact')))
    await mounted.unmount()
  })

  test('large groups expand, refold and reveal every node', async () => {
    const children = Array.from({ length: 24 }, (_, index) => node(`w${index}`, { running: index === 10 }))
    const forest: AgentForest = {
      nodes: [node('root'), ...children],
      edges: children.map(child => ({ from: 'root', to: child.id })),
      solo: false,
    }
    const mounted = await mount(h(AtlasGraph, propsOf(forest)))
    assert.equal(queryAll(mounted.container, '.lc-atlas-cluster').length, 1)
    assert.ok(queryAll(mounted.container, '.lc-atlas-node').length < 10)
    await click(query(mounted.container, '.lc-atlas-cluster'))
    assert.equal(queryAll(mounted.container, '.lc-atlas-node').length, 25)
    await click(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn:last-child'))
    assert.equal(queryAll(mounted.container, '.lc-atlas-cluster').length, 1)
    await click(query(mounted.container, '.lc-atlas-graph-tools > .lc-gran-btn:last-child'))
    assert.equal(queryAll(mounted.container, '.lc-atlas-node').length, 25)
    await mounted.unmount()
  })

  test('solo guidance and resize observation degrade cleanly', async () => {
    const callbacks: ResizeObserverCallback[] = []
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
      observe(): void {}
      disconnect(): void { disconnect() }
    })
    const forest: AgentForest = { nodes: [node('root')], edges: [], solo: true }
    const mounted = await mount(h(AtlasGraph, propsOf(forest)))
    assert.ok(text(mounted.container).includes(kit.t('agents.solo')))
    await act(async () => {
      callbacks[0]?.([{ contentRect: { width: 420 } } as ResizeObserverEntry], {} as ResizeObserver)
    })
    assert.equal(query<HTMLElement>(mounted.container, '.lc-atlas-canvas').style.width, '420px')
    const stage = query<HTMLElement>(mounted.container, '.lc-atlas-stage')
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 320 })
    await act(async () => { window.dispatchEvent(new Event('resize')) })
    assert.equal(query<HTMLElement>(mounted.container, '.lc-atlas-canvas').style.width, '320px')
    await mounted.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    vi.stubGlobal('ResizeObserver', undefined)
    const bare = await mount(h(AtlasGraph, propsOf(forest)))
    assert.equal(queryAll(bare.container, '.lc-atlas-node').length, 1)
    await bare.unmount()
  })
})
