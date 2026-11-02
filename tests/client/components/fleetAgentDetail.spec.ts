import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, expect, test, vi } from 'vitest'
import { FleetAgentDetail, type FleetAgentDetailProps } from '../../../src/client/components/fleetAgentDetail'
import type { AgentNode } from '../../../src/client/agentTree'
import type { CommsAgent } from '../../../src/client/commsModel'
import type { CommsRow } from '../../../src/client/fleetDetail'
import { click, makeKit, mount, query, queryAll, text } from '../helpers/kit'

const kit = makeKit()

function node(over: Partial<AgentNode> = {}): AgentNode {
  return {
    id: 'w1', label: 'worker', parentId: 'root', depth: 1, family: 0, isCurrent: false, running: false, completed: false,
    subagent: true, updatedAt: 1, head: null, requests: 4, billed: null, costUsage: null, durationMs: 42000,
    identity: { mode: 'one-shot' }, ...over,
  }
}

function agent(id: string, description?: string): CommsAgent {
  return { id, name: id === 'root' ? 'Lead' : id, role: id === 'root' ? 'lead' : 'teammate', self: id === 'root', hue: 'red', ...(description !== undefined ? { description } : {}) }
}

function propsOf(over: Partial<FleetAgentDetailProps> = {}): FleetAgentDetailProps {
  const current = node()
  return {
    node: current,
    agent: agent('w1', 'worker duty'),
    pinned: false,
    team: null,
    detail: undefined,
    roster: [],
    comms: [],
    agentOf: id => agent(id),
    onSelect: () => {},
    onClear: () => {},
    onOpen: () => {},
    onEnter: () => {},
    onFlow: () => {},
    onFocusTask: () => {},
    t: kit.t,
    fmt: kit.fmt,
    ...over,
  }
}

describe('FleetAgentDetail', () => {
  test('connects membership, tasks, traffic, navigation and expandable source details', async () => {
    const onSelect = vi.fn()
    const onClear = vi.fn()
    const onOpen = vi.fn()
    const onEnter = vi.fn()
    const onFlow = vi.fn()
    const onFocusTask = vi.fn()
    const comms: CommsRow[] = [
      { key: 'out', to: 'root', seq: 2, time: 2000, kind: 'relay', from: 'w1', text: 'out' },
      { key: 'in', to: 'w1', seq: 1, time: 1000, kind: 'relay', from: 'root', text: 'in' },
    ]
    const team = {
      members: [
        { id: 'root', name: 'lead', role: 'lead' as const, phase: 'active' as const },
        { id: 'w1', name: 'worker-bee', role: 'teammate' as const, phase: 'failed' as const, error: 'provision failed' },
      ],
      tasks: [
        { id: 'done', subject: 'done', description: '', status: 'completed' as const, ownerName: 'worker-bee', blockedBy: [], writeScopes: [], ready: true, warnings: [] },
        { id: 'active', subject: 'active', description: '', status: 'in_progress' as const, ownerName: 'worker-bee', blockedBy: [], writeScopes: [], ready: false, warnings: [] },
        { id: 'ready', subject: 'ready', description: '', status: 'pending' as const, ownerName: 'worker-bee', blockedBy: [], writeScopes: [], ready: true, warnings: [] },
        { id: 'blocked', subject: 'blocked', description: '', status: 'pending' as const, ownerName: 'worker-bee', blockedBy: ['done'], writeScopes: [], ready: false, warnings: [] },
      ],
    }
    const detail = {
      detail: {
        descriptor: { mode: 'one-shot' as const, agentModel: 'deepseek-v4', agentReasoningEffort: 'high' },
        initialPrompt: 'Review the schema parser.',
        lastReply: { time: 3000, text: 'All checks passed.' },
        messages: [],
        truncated: false,
      },
    }
    const mounted = await mount(h(FleetAgentDetail, propsOf({
      team,
      detail,
      roster: [{ name: 'worker-bee', description: 'schema duty' }],
      comms,
      pinned: true,
      onSelect,
      onClear,
      onOpen,
      onEnter,
      onFlow,
      onFocusTask,
    })))
    assert.ok(text(mounted.container).includes('deepseek-v4 (high)'))
    assert.ok(text(mounted.container).includes('schema duty'))
    assert.ok(text(mounted.container).includes('provision failed'))
    assert.ok(text(mounted.container).includes('1/4'))
    await click(query(mounted.container, '.lc-atlas-detail-actions .lc-inspector-btn'))
    await click(query(mounted.container, '[aria-label="Open in sidebar"]'))
    await click(query(mounted.container, '[aria-label="Open session"]'))
    await click(query(mounted.container, '.lc-atlas-parent'))
    await click(query(mounted.container, '[data-detail-task="ready"]'))
    const flowButtons = queryAll(mounted.container, '.lc-atlas-connections button')
    await click(flowButtons[0])
    await click(flowButtons[1])
    expect(onClear).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith('w1')
    expect(onEnter).toHaveBeenCalledWith('w1')
    expect(onSelect).toHaveBeenCalledWith('root')
    expect(onFocusTask).toHaveBeenCalledWith('ready')
    assert.deepEqual(onFlow.mock.calls.map(call => call[0]), ['w1\u0000root', 'root\u0000w1'])
    await click(query(mounted.container, '.lc-atlas-reply + .lc-inspector-btn'))
    assert.ok(query(mounted.container, '.lc-atlas-reply').className.includes('lc-atlas-reply-open'))
    await click(query(mounted.container, '.lc-atlas-prompt + .lc-inspector-btn'))
    assert.ok(query(mounted.container, '.lc-atlas-prompt').className.includes('lc-atlas-prompt-open'))
    await mounted.update(h(FleetAgentDetail, propsOf({ node: node({ id: 'other' }), detail })))
    assert.ok(!query(mounted.container, '.lc-atlas-prompt').className.includes('lc-atlas-prompt-open'))
    assert.ok(!query(mounted.container, '.lc-atlas-reply').className.includes('lc-atlas-reply-open'))
    await mounted.unmount()
  })

  test('the current running agent stays free of navigation and exposes runtime facts while loading', async () => {
    const mounted = await mount(h(FleetAgentDetail, propsOf({
      node: node({ id: 'root', parentId: undefined, isCurrent: true, running: true, identity: null, durationMs: null, requests: 0, model: 'deepseek-v4', reasoningEffort: 'max' }),
      agent: agent('root'),
    })))
    assert.ok(text(mounted.container).includes('deepseek-v4 (max)'))
    assert.ok(text(mounted.container).includes(kit.t('fleet.detailLoading')))
    assert.equal(queryAll(mounted.container, '.lc-atlas-parent, .lc-atlas-connections, [aria-label="Open session"]').length, 0)
    await mounted.unmount()
  })
})
