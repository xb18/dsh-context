import { act, createElement as h } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { makeFleetView } from '../../../src/client/components/fleetView'
import { makeAgentHeads } from '../../../src/client/agentHeads'
import { DICT_EN } from '../../../src/client/i18n'
import { resetTimelineDetailStores } from '../../../src/client/timelineSource'
import { TestClientCtx, asClientCtx } from '../helpers/harness'
import { click, hover, makeKit, mount, query, queryAll, text, typeText, until } from '../helpers/kit'
import { projectionsFor, richTimeline } from './contextViewHarness'

const kit = makeKit()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetTimelineDetailStores()
})

const TEAM = {
  members: [
    { id: 'root', name: 'lead', role: 'lead', phase: 'active' },
    { id: 'w1', name: 'worker-bee', role: 'teammate', phase: 'active' },
    { id: 'w9', name: 'ghost-nine', role: 'teammate', phase: 'active' },
  ],
  tasks: [
    { id: 'task-0', subject: 'prepare fixtures', description: 'Prepare the shared fixtures.', status: 'completed', ownerName: 'lead', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] },
    { id: 'task-1', subject: 'schema parsing', description: 'Parse it.', status: 'in_progress', ownerName: 'worker-bee', blockedBy: ['task-0'], writeScopes: ['src/'], ready: false, writeScopeWarnings: ['shared src'] },
  ],
}

function familySessions() {
  const snapshot = {
    byId: {
      root: { displayTitle: 'Main Agent', running: true, updatedAt: 10, projectionValues: { agentTeam: TEAM } },
      w1: {
        parentId: 'root', origin: 'subagent', running: true, updatedAt: 8,
        projectionValues: { subagent: { mode: 'continuable', label: 'worker-bee' }, subagentTiming: { settledMs: 42000 } },
      },
      w2: {
        parentId: 'root', origin: 'subagent', running: false, updatedAt: 6,
        projectionValues: { subagent: { mode: 'one-shot', label: 'side-quest' }, subagentTiming: { settledMs: 9000, lastTurnCompleted: true } },
      },
    },
  }
  return { list: { getSnapshot: (): unknown => snapshot, subscribe: (): (() => void) => () => {} } }
}

function stubFleetRoute(): void {
  vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
    const { sessionId } = JSON.parse(init.body) as { sessionId: string }
    const messages = sessionId === 'w1'
      ? [
        { seq: 9, time: 9000, kind: 'relay', from: 'root', text: 'how far along?' },
        { seq: 8, time: 8000, kind: 'relay', from: 'w9', text: 'ghost says hi' },
        { seq: 7, time: 7000, kind: 'relay', from: 'stranger', text: 'who dis' },
        { seq: 6, time: 6000, kind: 'relay', from: 'root', text: 'second from lead' },
        { seq: 5, time: 5000, kind: 'relay', from: 'w1', text: 'note to self' },
        { seq: 4, time: 4000, kind: 'mailbox', text: 'anonymous delivery' },
      ]
      : sessionId === 'root'
        ? [
          { seq: 3, time: 3000, kind: 'relay', from: 'w2', text: 'side quest update' },
          { seq: 2, time: 2000, kind: 'settled', from: 'w1', text: 'done', summary: 'done', report: 'all green' },
        ]
        : sessionId === 'w2'
          ? [{ seq: 1, time: 1000, kind: 'relay', from: 'root', text: 'start side quest' }]
          : []
    const value = sessionId === 'w1'
      ? {
        descriptor: { mode: 'continuable', label: 'worker-bee', provider: 'spawn', agentModel: 'deepseek-v4' },
        initialPrompt: 'Review the schema parser.',
        lastReply: { time: 8500, text: '13 of 15 cases' },
        messages,
        truncated: false,
      }
      : sessionId === 'root'
        ? {
          messages,
          truncated: false,
          roster: [
            { name: 'worker-bee', description: 'schema duty' },
            { name: 'ghost-nine', description: 'ghost duty' },
          ],
        }
        : { messages, truncated: false }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value }) } as Response)
  })
}

function makeView(ctx: TestClientCtx, useKit = kit) {
  return makeFleetView(asClientCtx(ctx), useKit, makeAgentHeads())
}

async function mountFamily(ctx = new TestClientCtx({ services: { sessions: familySessions() } })) {
  stubFleetRoute()
  const View = makeView(ctx)
  const mounted = await mount(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline()) }))
  await until(() => queryAll(mounted.container, '.lc-comms-event').length === 9, 'family traffic never landed')
  return { ctx, mounted }
}

describe('FleetView — command atlas', () => {
  test('renders one shared model without member repetition or context composition', async () => {
    const { ctx, mounted } = await mountFamily()
    assert.equal(queryAll(mounted.container, '.lc-atlas-node').length, 4)
    assert.ok(text(query(mounted.container, '[data-agent="w9"]')).includes('ghost-nine'))
    assert.equal(queryAll(mounted.container, '.lc-members, .lc-tasks, .lc-comms-channels, .lc-agent-bar, .lc-summary').length, 0)
    assert.ok(text(query(mounted.container, '.lc-atlas-work')).includes('schema parsing'))
    assert.ok(text(query(mounted.container, '.lc-atlas-work')).includes('side-quest'))
    assert.ok(!text(mounted.container).includes('tokens in context'))
    assert.ok(!text(mounted.container).includes(DICT_EN['footer']))
    await mounted.unmount()
    ctx.dispose()
  })

  test('an agent selection drives the graph, work and activity together', async () => {
    const { ctx, mounted } = await mountFamily()
    const node = query(mounted.container, '[data-agent="w1"]')
    await hover(node)
    assert.ok(node.className.includes('lc-atlas-node-hover'))
    await click(node)
    assert.ok(node.className.includes('lc-atlas-node-selected'))
    assert.equal(queryAll(mounted.container, '[data-task="task-1"]').length, 1)
    assert.equal(queryAll(mounted.container, '[data-task="agent:w2"]').length, 0)
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 7)
    assert.ok(text(query(mounted.container, '.lc-atlas-detail')).includes('schema duty'))
    assert.ok(text(query(mounted.container, '.lc-atlas-detail')).includes('13 of 15 cases'))
    await click(node)
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 9)
    await click(node)
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 7)
    await click(query(mounted.container, '.lc-atlas-detail .lc-inspector-btn'))
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 9)
    assert.equal(queryAll(mounted.container, '[data-task="agent:w2"]').length, 1)
    await mounted.unmount()
    ctx.dispose()
  })

  test('a directed graph edge scopes only that direction and releases cleanly', async () => {
    const { ctx, mounted } = await mountFamily()
    await click(query(mounted.container, '[data-agent="w2"]'))
    const edge = query<SVGPathElement>(mounted.container, '.lc-atlas-flow-hit')
    assert.ok(edge.getAttribute('aria-label')?.includes('Lead → worker-bee · 2 relay'))
    await act(async () => { edge.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 2)
    assert.equal(queryAll(mounted.container, '.lc-atlas-node-selected').length, 1)
    assert.ok(query(mounted.container, '[data-agent="root"]').className.includes('lc-atlas-node-selected'))
    assert.equal(queryAll(mounted.container, '[data-task="task-0"]').length, 1)
    assert.ok(text(query(mounted.container, '.lc-atlas-scope')).includes('Lead → worker-bee'))
    await click(query(mounted.container, '.lc-atlas-scope'))
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 5)
    await click(query(mounted.container, '[data-task="task-0"] .lc-atlas-work-open'))
    assert.equal(queryAll(mounted.container, '.lc-atlas-flow-on').length, 0)
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 5)
    await click(query(mounted.container, '[data-task="task-0"] .lc-atlas-work-open'))
    assert.equal(query(mounted.container, '[data-task="task-0"] .lc-atlas-work-open').getAttribute('aria-expanded'), 'false')
    await click(query(mounted.container, '.lc-atlas-scope'))
    assert.equal(queryAll(mounted.container, '.lc-comms-event').length, 9)
    await mounted.unmount()
    ctx.dispose()
  })

  test('task expansion, dependencies and owner focus stay connected', async () => {
    const { ctx, mounted } = await mountFamily()
    await click(query(mounted.container, '[data-task="task-1"] .lc-atlas-work-open'))
    assert.ok(text(query(mounted.container, '[data-task="task-1"]')).includes('shared src'))
    await click(query(mounted.container, '[data-agent="w1"]'))
    await click(query(mounted.container, '[data-task-dep="task-0"]'))
    assert.equal(queryAll(mounted.container, '[data-task="task-0"].lc-atlas-work-item-focus').length, 1)
    assert.equal(queryAll(mounted.container, '.lc-atlas-node-selected').length, 0)
    await click(query(mounted.container, '[data-task="task-1"] .lc-atlas-owner'))
    assert.ok(query(mounted.container, '[data-agent="w1"]').className.includes('lc-atlas-node-selected'))
    assert.equal(queryAll(mounted.container, '[data-task="task-0"]').length, 0)
    await mounted.unmount()
    ctx.dispose()
  })

  test('event participants and agent navigation retain session actions', async () => {
    const opened: string[] = []
    const ctx = new TestClientCtx({ services: { sessions: familySessions(), uiWorkspace: { openSession: (id: string) => { opened.push(id) } } } })
    const { mounted } = await mountFamily(ctx)
    const first = query(mounted.container, '.lc-comms-event')
    await click(query(first, '.lc-comms-hit'))
    const peer = queryAll<HTMLElement>(mounted.container, '.lc-comms-person').find(person => text(person).includes('worker-bee'))!
    await click(queryAll<HTMLElement>(peer, '.lc-inspector-btn')[0]!)
    assert.ok(query(mounted.container, '[data-agent="w1"]').className.includes('lc-atlas-node-selected'))
    await click(query(mounted.container, '.lc-atlas-detail [aria-label="Open in sidebar"]'))
    await click(query(mounted.container, '.lc-atlas-detail [aria-label="Open session"]'))
    assert.deepEqual(opened, ['w1', 'w1'])
    await mounted.unmount()
    ctx.dispose()
  })

  test('a direct team projection without a forest still serves work without inventing a graph', async () => {
    stubFleetRoute()
    const ctx = new TestClientCtx({ services: {} })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline(), { agentTeam: TEAM }) }))
    assert.equal(queryAll(mounted.container, '.lc-atlas-graph').length, 0)
    assert.equal(queryAll(mounted.container, '.lc-atlas-activity').length, 1)
    await until(() => queryAll(mounted.container, '.lc-comms-event').length === 8, 'team-only traffic never landed')
    assert.ok(text(query(mounted.container, '.lc-atlas-metrics')).includes('—'))
    assert.ok(text(query(mounted.container, '.lc-atlas-work')).includes('schema parsing'))
    assert.ok(text(query(mounted.container, '.lc-atlas-metrics')).includes('3'))
    await mounted.unmount()
    ctx.dispose()
  })

  test('roster changes remove stale selections without duplicating known sessions', async () => {
    stubFleetRoute()
    const ctx = new TestClientCtx({ services: { sessions: familySessions() } })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline(), { agentTeam: TEAM }) }))
    await click(query(mounted.container, '[data-agent="w9"]'))
    assert.ok(query(mounted.container, '[data-agent="w9"]').className.includes('lc-atlas-node-selected'))
    const reduced = { ...TEAM, members: TEAM.members.filter(member => member.id !== 'w9') }
    await mounted.update(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline(), { agentTeam: reduced }) }))
    await until(() => queryAll(mounted.container, '.lc-atlas-node-selected').length === 0, 'stale roster selection never cleared')
    const complete = {
      ...TEAM,
      members: [
        TEAM.members[0],
        TEAM.members[1],
        { id: 'w2', name: 'side-quest', role: 'teammate', phase: 'active' },
      ],
    }
    await mounted.update(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline(), { agentTeam: complete }) }))
    assert.equal(queryAll(mounted.container, '.lc-atlas-node').length, 3)
    await mounted.unmount()
    ctx.dispose()
  })

  test('preview details remain visible when complete-history reads fail', async () => {
    const snapshot = {
      byId: {
        'preview-root': { displayTitle: 'Main Agent', running: false, updatedAt: 10 },
        'preview-w1': { parentId: 'preview-root', origin: 'subagent', running: false, updatedAt: 8, projectionValues: { subagent: { mode: 'continuable', label: 'preview-worker' } } },
      },
    }
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { sessionId: string; history?: boolean }
      const value = body.history === true ? null : body.sessionId === 'preview-w1'
        ? { messages: [{ seq: 1, time: 1000, kind: 'relay', from: 'preview-root', text: 'preview event' }], truncated: false }
        : { messages: [], truncated: false }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value }) } as Response)
    })
    const ctx = new TestClientCtx({ services: { sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } } } })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'preview-root', useProjection: projectionsFor(richTimeline()) }))
    await until(() => queryAll(mounted.container, '.lc-comms-event').length === 1, 'preview fallback never landed')
    assert.ok(text(mounted.container).includes('preview event'))
    await mounted.unmount()
    ctx.dispose()
  })

  test('failed detail reads leave team work standing and settle to an empty stream', async () => {
    const team = {
      members: [
        { id: 'cold-root', name: 'lead', role: 'lead', phase: 'active' },
        { id: 'cold-w1', name: 'cold-worker', role: 'teammate', phase: 'active' },
      ],
      tasks: [],
    }
    const snapshot = {
      byId: {
        'cold-root': { displayTitle: 'Cold Lead', running: false, updatedAt: 3, projectionValues: { agentTeam: team } },
        'cold-w1': { parentId: 'cold-root', origin: 'subagent', running: false, updatedAt: 2, projectionValues: { subagent: { mode: 'one-shot', label: 'cold-worker' } } },
      },
    }
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 503 } as Response))
    const ctx = new TestClientCtx({ services: { sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } } } })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'cold-root', useProjection: projectionsFor(richTimeline()) }))
    assert.ok(text(mounted.container).includes('cold-worker'))
    await until(() => text(query(mounted.container, '.lc-atlas-activity')).includes(DICT_EN['fleet.comms.empty']), 'failed reads never settled')
    await mounted.unmount()
    ctx.dispose()
  })

  test('an in-place session switch drops every old event and resets graph scopes', async () => {
    stubFleetRoute()
    let snapshot: unknown = {
      byId: {
        root: { displayTitle: 'Main Agent', running: true, updatedAt: 10, projectionValues: { agentTeam: TEAM } },
        w1: { parentId: 'root', origin: 'subagent', running: true, updatedAt: 8, projectionValues: { subagent: { mode: 'continuable', label: 'worker-bee' } } },
        w2: { parentId: 'root', origin: 'subagent', running: false, updatedAt: 6, projectionValues: { subagent: { mode: 'one-shot', label: 'side-quest' } } },
      },
    }
    const listeners = new Set<() => void>()
    const face = {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      },
    }
    const ctx = new TestClientCtx({ services: { sessions: face } })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline()) }))
    await until(() => queryAll(mounted.container, '.lc-comms-event').length === 9, 'initial family never landed')
    await typeText(query(mounted.container, '.lc-atlas-graph-tools .lc-fleet-search'), 'worker')
    snapshot = { byId: { solo: { displayTitle: 'Solo', running: false, updatedAt: 1 } } }
    for (const listener of listeners) listener()
    await mounted.update(h(View, { sessionId: 'solo', useProjection: projectionsFor(richTimeline()) }))
    await until(() => queryAll(mounted.container, '.lc-comms-event').length === 0, 'old-session traffic contaminated solo')
    assert.ok(text(query(mounted.container, '.lc-atlas-metrics')).includes('0'))
    assert.equal(query<HTMLInputElement>(mounted.container, '.lc-atlas-graph-tools .lc-fleet-search').value, '')
    assert.equal(queryAll(mounted.container, '.lc-atlas-node').length, 1)
    await mounted.unmount()
    ctx.dispose()
  })

  test('complete history backfills beyond the preview cap without any user action', async () => {
    const snapshot = {
      byId: {
        'hist-root': { displayTitle: 'Main Agent', running: false, updatedAt: 10 },
        'hist-w1': { parentId: 'hist-root', origin: 'subagent', running: false, updatedAt: 8, projectionValues: { subagent: { mode: 'continuable', label: 'history-worker' } } },
      },
    }
    const messages = Array.from({ length: 85 }, (_, index) => ({ seq: index + 1, time: 1000 + index, kind: 'relay', from: 'hist-root', text: `event ${index + 1}` }))
    vi.stubGlobal('fetch', (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as { sessionId: string; history?: boolean }
      const value = body.sessionId === 'hist-w1'
        ? { messages: body.history === true ? messages : messages.slice(0, 80), truncated: true }
        : { messages: [], truncated: false }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value }) } as Response)
    })
    const ctx = new TestClientCtx({ services: { sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } } } })
    const View = makeView(ctx)
    const mounted = await mount(h(View, { sessionId: 'hist-root', useProjection: projectionsFor(richTimeline()) }))
    await until(() => text(query(mounted.container, '.lc-atlas-metrics')).includes('85'), 'complete history never backfilled')
    const list = query(mounted.container, '.lc-atlas-event-list')
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 256 })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    list.scrollTop = 640
    await act(async () => { list.dispatchEvent(new Event('scroll')) })
    await until(() => queryAll(mounted.container, '.lc-comms-event').length < 85, 'event window never bounded the DOM')
    await click(query(mounted.container, '.lc-atlas-event-list .lc-comms-hit'))
    assert.ok(query(mounted.container, '.lc-comms-detail') !== null)
    assert.ok(queryAll(mounted.container, '.lc-comms-event').length < 85)
    assert.ok(text(query(mounted.container, '.lc-atlas-metrics')).includes('85'))
    await mounted.unmount()
    ctx.dispose()
  })

  test('the atlas localizes its new vocabulary', async () => {
    const ctx = new TestClientCtx({ services: { sessions: familySessions() } })
    stubFleetRoute()
    const View = makeView(ctx, makeKit('zh'))
    const mounted = await mount(h(View, { sessionId: 'root', useProjection: projectionsFor(richTimeline()) }))
    assert.ok(text(query(mounted.container, '.lc-atlas-heading')).includes('指挥图谱'))
    assert.ok(text(query(mounted.container, '.lc-atlas-graph')).includes('关系画布'))
    await mounted.unmount()
    ctx.dispose()
  })
})
