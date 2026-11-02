import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, expect, test, vi } from 'vitest'
import { FleetWork, workItemsOf, type FleetWorkProps } from '../../../src/client/components/fleetWork'
import type { AgentForest, AgentNode } from '../../../src/client/agentTree'
import type { CommsAgent } from '../../../src/client/commsModel'
import { click, makeKit, mount, query, text } from '../helpers/kit'

const kit = makeKit()

function node(id: string, over: Partial<AgentNode> = {}): AgentNode {
  return {
    id, label: id, parentId: 'root', depth: 1, family: 0, isCurrent: false, running: false, completed: false, subagent: true,
    updatedAt: 1, head: null, requests: 0, billed: null, costUsage: null, durationMs: null, identity: null, ...over,
  }
}

function propsOf(over: Partial<FleetWorkProps> = {}): FleetWorkProps {
  return {
    team: null,
    forest: null,
    details: { landed: new Map(), historyLanded: new Map(), fullLanded: new Map(), pending: new Set(), historyPending: new Set(), fullPending: new Set(), request: vi.fn(), requestHistory: vi.fn(), requestFull: vi.fn() },
    selectedId: null,
    focusTaskId: null,
    agentOf: (id: string): CommsAgent => ({ id, name: id, role: 'subagent', self: false, hue: 'red' }),
    onSelect: () => {},
    onFocusTask: () => {},
    t: kit.t,
    ...over,
  }
}

describe('FleetWork', () => {
  test('separates team task completion from subagent idle and latest-turn completion', () => {
    const forest: AgentForest = {
      nodes: [node('root', { isCurrent: true, parentId: undefined }), node('running', { running: true }), node('idle', { completed: true })],
      edges: [],
      solo: false,
    }
    const items = workItemsOf(null, forest)
    assert.deepEqual(items.map(item => [item.id, item.status, item.turnCompleted]), [
      ['agent:running', 'in_progress', false],
      ['agent:idle', 'idle', true],
    ])
    assert.deepEqual(workItemsOf(null, null), [])
  })

  test('renders unowned tasks, failures, delegation prompts and empty filtered scopes', async () => {
    const team = {
      members: [{ id: 'root', name: 'lead', role: 'lead' as const, phase: 'active' as const }],
      tasks: [
        { id: 'unowned', subject: 'Unowned work', description: '', status: 'pending' as const, blockedBy: [], writeScopes: [], ready: true, warnings: [] },
        { id: 'done', subject: 'Done work', description: 'Finished.', status: 'completed' as const, ownerName: 'lead', blockedBy: [], writeScopes: [], ready: false, warnings: [] },
      ],
      failure: 'bad revision',
    }
    const forest: AgentForest = {
      nodes: [node('root', { isCurrent: true, parentId: undefined }), node('child', { identity: { mode: 'continuable' } })],
      edges: [],
      solo: false,
    }
    const details = propsOf().details
    details.landed = new Map([['child', { detail: { initialPrompt: 'Delegation brief', messages: [], truncated: false }, updatedAt: 1 }]])
    const onFocusTask = vi.fn()
    const mounted = await mount(h(FleetWork, propsOf({ team, forest, details, focusTaskId: 'unowned', onFocusTask })))
    assert.ok(text(mounted.container).includes('bad revision'))
    assert.ok(text(mounted.container).includes(kit.t('fleet.taskUnowned')))
    assert.ok(text(mounted.container).includes('1/2'))
    await click(query(mounted.container, '[data-task="unowned"] .lc-atlas-work-open'))
    expect(onFocusTask).toHaveBeenCalledWith(null)
    await mounted.update(h(FleetWork, propsOf({ team, forest, details, focusTaskId: 'agent:child', onFocusTask })))
    assert.ok(text(mounted.container).includes('Delegation brief'))
    assert.ok(!text(mounted.container).includes(kit.t('fleet.atlas.turnDone')))
    await mounted.update(h(FleetWork, propsOf({ team, forest, details, selectedId: 'missing', onFocusTask })))
    assert.ok(text(mounted.container).includes(kit.t('fleet.tasks.noMatch')))
    await mounted.update(h(FleetWork, propsOf({ onFocusTask })))
    assert.ok(text(mounted.container).includes(kit.t('fleet.tasks.noTeam')))
    await mounted.unmount()
  })
})
