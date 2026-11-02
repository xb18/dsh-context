import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, expect, test, vi } from 'vitest'
import { ActivityFeed, type ActivityFeedProps } from '../../../src/client/components/activityFeed'
import { flowKeyOf } from '../../../src/client/fleetActivity'
import type { CommsRow } from '../../../src/client/fleetDetail'
import type { FleetDetailState } from '../../../src/client/fleetModel'
import type { CommsAgent } from '../../../src/client/commsModel'
import type { FleetDetail } from '../../../src/shared/types'
import { makeRichText } from '../../../src/client/components/richText'
import { click, makeKit, mount, query, queryAll, text, typeText } from '../helpers/kit'

const kit = makeKit()
const rich = makeRichText(kit)
const AGENTS = new Map<string, CommsAgent>([
  ['root', { id: 'root', name: 'Lead', role: 'lead', self: true, hue: 'hsl(210 60% 50%)' }],
  ['w1', { id: 'w1', name: 'host-cleaner', role: 'teammate', self: false, hue: 'hsl(120 45% 45%)' }],
  ['w2', { id: 'w2', name: 'tests-host', role: 'teammate', self: false, hue: 'hsl(30 60% 50%)' }],
])
const COMMS: CommsRow[] = [
  { key: 'w1:10:8000:relay', to: 'w1', seq: 10, time: 8000, kind: 'relay', from: 'root', text: 'how far along?' },
  { key: 'root:9:7000:relay', to: 'root', seq: 9, time: 7000, kind: 'relay', from: 'w1', text: 'task done — all gates green' },
  { key: 'root:8:6000:settled', to: 'root', seq: 8, time: 6000, kind: 'settled', from: 'w1', text: 'settled', report: 'check passed' },
  { key: 'w2:7:5000:relay', to: 'w2', seq: 7, time: 5000, kind: 'relay', from: 'root', text: 'check the tests' },
  { key: 'root:6:4000:mailbox', to: 'root', seq: 6, time: 4000, kind: 'mailbox', from: 'w2', text: 'legacy delivery' },
  { key: 'w2:5:3000:relay', to: 'w2', seq: 5, time: 3000, kind: 'relay', from: 'w1', text: 'peer sync' },
  { key: 'root:4:2000:relay', to: 'root', seq: 4, time: 2000, kind: 'relay', from: 'w2', text: 'short…', clipped: true },
  { key: 'root:3:1500:mailbox', to: 'root', seq: 3, time: 1500, kind: 'mailbox', fromName: 'legacy', text: 'ancient mailbox' },
  { key: 'w1:2:1000:relay', to: 'w1', seq: 2, time: 1000, kind: 'relay', from: 'root', text: 'kickoff' },
  { key: 'root:1:500:relay', to: 'root', seq: 1, time: 500, kind: 'relay', text: 'mystery' },
]

function detailsOf(over: Partial<FleetDetailState> = {}): FleetDetailState {
  return { landed: new Map(), historyLanded: new Map(), fullLanded: new Map(), pending: new Set(), historyPending: new Set(), fullPending: new Set(), request: vi.fn(), requestHistory: vi.fn(), requestFull: vi.fn(), ...over }
}

function propsOf(over: Partial<ActivityFeedProps> = {}): ActivityFeedProps {
  return {
    details: detailsOf(),
    comms: COMMS,
    agents: AGENTS,
    titles: new Map(),
    attested: new Map(),
    selectedId: null,
    flowKey: null,
    onClearFlow: () => {},
    pinnedId: null,
    onSelect: () => {},
    onOpen: () => {},
    onEnter: () => {},
    rich,
    t: kit.t,
    ...over,
  }
}

function events(container: HTMLElement): HTMLElement[] {
  return queryAll(container, '.lc-comms-event')
}

describe('ActivityFeed', () => {
  test('orders, filters, searches and selects time bins without channel cards', async () => {
    const mounted = await mount(h(ActivityFeed, propsOf()))
    assert.equal(events(mounted.container).length, 10)
    assert.equal(queryAll(mounted.container, '.lc-comms-channel').length, 0)
    assert.equal(events(mounted.container)[0].dataset.commsKey, COMMS[0].key)
    await click(query(mounted.container, '.lc-comms-order'))
    assert.equal(events(mounted.container)[0].dataset.commsKey, COMMS[9].key)
    await click(query(mounted.container, '.lc-comms-order'))
    const chips = queryAll(mounted.container, '.lc-fleet-filters .lc-gran-btn')
    await click(chips[2])
    assert.equal(events(mounted.container).length, 1)
    await click(chips[1])
    assert.equal(events(mounted.container).length, 9)
    await click(chips[0])
    const search = query<HTMLInputElement>(mounted.container, '.lc-fleet-search')
    await typeText(search, 'host-cleaner')
    assert.equal(events(mounted.container).length, 5)
    await typeText(search, 'check passed')
    assert.equal(events(mounted.container).length, 1)
    await typeText(search, 'zzz')
    assert.ok(text(mounted.container).includes(kit.t('fleet.comms.noMatch')))
    await typeText(search, '')
    const bin = query(mounted.container, '.lc-atlas-bins button')
    await click(bin)
    assert.equal(bin.getAttribute('aria-pressed'), 'true')
    assert.ok(events(mounted.container).length < 10)
    await click(bin)
    assert.equal(events(mounted.container).length, 10)
    await mounted.unmount()
  })

  test('a selected bin keeps its start when later events arrive', async () => {
    const mounted = await mount(h(ActivityFeed, propsOf()))
    const bin = query(mounted.container, '.lc-atlas-bins button')
    await click(bin)
    const title = bin.getAttribute('title')
    const later: CommsRow = { key: 'later', to: 'root', seq: 99, time: 9999, kind: 'relay', from: 'w1', text: 'later' }
    await mounted.update(h(ActivityFeed, propsOf({ comms: [later, ...COMMS] })))
    const selected = query(mounted.container, '.lc-atlas-bin-on')
    assert.equal(selected.getAttribute('title'), title)
    assert.ok(events(mounted.container).length < COMMS.length + 1)
    await mounted.unmount()
  })

  test('agent and directed-flow scopes clear through their own actions', async () => {
    const onSelect = vi.fn()
    const selected = await mount(h(ActivityFeed, propsOf({ selectedId: 'w2', onSelect })))
    assert.equal(events(selected.container).length, 4)
    assert.ok(text(query(selected.container, '.lc-atlas-scope')).includes('tests-host'))
    await click(query(selected.container, '.lc-atlas-scope'))
    assert.deepEqual(onSelect.mock.calls, [['w2']])
    await selected.unmount()

    const onClearFlow = vi.fn()
    const key = flowKeyOf(COMMS[0])
    const flow = await mount(h(ActivityFeed, propsOf({ flowKey: key, onClearFlow })))
    assert.equal(events(flow.container).length, 2)
    assert.ok(text(query(flow.container, '.lc-atlas-scope')).includes('Lead → host-cleaner'))
    await click(query(flow.container, '.lc-atlas-scope'))
    expect(onClearFlow).toHaveBeenCalledOnce()
    await flow.unmount()

    const missing = await mount(h(ActivityFeed, propsOf({ flowKey: 'missing' })))
    assert.equal(queryAll(missing.container, '.lc-atlas-scope').length, 0)
    assert.ok(text(missing.container).includes(kit.t('fleet.comms.noMatch')))
    await missing.unmount()
  })

  test('event details toggle, request clipped full text and use a landed full read', async () => {
    const details = detailsOf({ fullPending: new Set(['root']) })
    const mounted = await mount(h(ActivityFeed, propsOf({ details })))
    const first = events(mounted.container)[0]
    await click(query(first, '.lc-comms-hit'))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 1)
    expect(details.requestFull).not.toHaveBeenCalled()
    await click(query(first, '.lc-comms-hit'))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 0)
    const clipped = events(mounted.container).find(event => event.dataset.commsKey === COMMS[6].key)!
    await click(query(clipped, '.lc-comms-hit'))
    expect(details.requestFull).toHaveBeenCalledWith('root')
    assert.ok(text(mounted.container).includes(kit.t('fleet.comms.detail.loading')))
    const full: FleetDetail = { messages: [{ seq: 4, time: 2000, kind: 'relay', from: 'w2', text: 'full replacement' }], truncated: false }
    await mounted.update(h(ActivityFeed, propsOf({ details: detailsOf({ fullLanded: new Map([['root', full]]) }) })))
    assert.ok(text(query(mounted.container, '.lc-comms-detail-body')).includes('full replacement'))
    await click(query(mounted.container, '.lc-comms-detail-close'))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 0)
    await mounted.unmount()
  })

  test('participant actions filter and open sessions from the event detail', async () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const onEnter = vi.fn()
    const mounted = await mount(h(ActivityFeed, propsOf({ onSelect, onOpen, onEnter })))
    await click(query(events(mounted.container)[0], '.lc-comms-hit'))
    const peer = queryAll<HTMLElement>(mounted.container, '.lc-comms-person').find(person => text(person).includes('host-cleaner'))!
    const actions = queryAll<HTMLElement>(peer, '.lc-inspector-btn')
    await click(actions[0])
    await click(actions[1])
    await click(actions[2])
    expect(onSelect).toHaveBeenCalledWith('w1')
    expect(onOpen).toHaveBeenCalledWith('w1')
    expect(onEnter).toHaveBeenCalledWith('w1')
    await mounted.unmount()
  })

  test('scope changes close an open record and clear the time selection', async () => {
    const mounted = await mount(h(ActivityFeed, propsOf()))
    await click(query(mounted.container, '.lc-atlas-bins button'))
    await click(query(events(mounted.container)[0], '.lc-comms-hit'))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 1)
    await mounted.update(h(ActivityFeed, propsOf({ selectedId: 'w2' })))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 0)
    assert.ok(queryAll(mounted.container, '.lc-atlas-bins button').every(bin => bin.getAttribute('aria-pressed') === 'false'))
    await typeText(query<HTMLInputElement>(mounted.container, '.lc-fleet-search'), 'host')
    await click(queryAll(mounted.container, '.lc-fleet-filters .lc-gran-btn')[2])
    await click(query(mounted.container, '.lc-comms-order'))
    await mounted.update(h(ActivityFeed, propsOf({ sessionId: 'two' })))
    assert.equal(query<HTMLInputElement>(mounted.container, '.lc-fleet-search').value, '')
    assert.equal(query(mounted.container, '.lc-comms-order').textContent, kit.t('fleet.comms.orderNewest'))
    assert.equal(queryAll(mounted.container, '.lc-comms-detail').length, 0)
    assert.equal(queryAll(mounted.container, '.lc-fleet-filters .lc-gran-on').length, 1)
    assert.ok(text(query(mounted.container, '.lc-fleet-filters .lc-gran-on')).includes(kit.t('fleet.comms.kind.all')))
    await mounted.unmount()
  })

  test('loading, empty and history notes reflect the complete loaded scope', async () => {
    for (const [details, empty] of [
      [detailsOf({ pending: new Set(['root']) }), false],
      [detailsOf(), false],
      [detailsOf({ landed: new Map([['root', { detail: { messages: [], truncated: false }, updatedAt: 1 }]]) }), true],
    ] as const) {
      const mounted = await mount(h(ActivityFeed, propsOf({ comms: [], details })))
      assert.equal(queryAll(mounted.container, '.lc-comms-skeleton').length, empty ? 0 : 1)
      assert.equal(text(mounted.container).includes(kit.t('fleet.comms.empty')), empty)
      await mounted.unmount()
    }
    const landed = new Map([['root', { detail: { messages: [], messagesTotal: 42, truncated: true }, updatedAt: 1 }]])
    const notes = await mount(h(ActivityFeed, propsOf({ details: detailsOf({ landed }) })))
    assert.ok(text(query(notes.container, '.lc-comms-notes')).includes(kit.t('fleet.comms.hidden', { n: 42 })))
    assert.ok(text(query(notes.container, '.lc-comms-notes')).includes(kit.t('fleet.comms.clipped', { n: 1 })))
    await notes.unmount()
    const hiddenOnly = new Map([['root', { detail: { messages: [], messagesTotal: 7, truncated: true }, updatedAt: 1 }]])
    const withoutClips = await mount(h(ActivityFeed, propsOf({
      comms: COMMS.filter(row => row.clipped !== true),
      details: detailsOf({ landed: hiddenOnly }),
    })))
    assert.ok(text(query(withoutClips.container, '.lc-comms-notes')).includes(kit.t('fleet.comms.hidden', { n: 7 })))
    assert.ok(!text(query(withoutClips.container, '.lc-comms-notes')).includes(kit.t('fleet.comms.clipped', { n: 1 })))
    await withoutClips.unmount()
    const completeHistory = detailsOf({
      landed,
      historyLanded: new Map([['root', { detail: { messages: Array.from({ length: 42 }, (_, index) => ({ seq: index, time: index, kind: 'relay' as const, text: 'x' })), truncated: false }, updatedAt: 1 }]]),
    })
    const complete = await mount(h(ActivityFeed, propsOf({ details: completeHistory })))
    assert.ok(!text(complete.container).includes(kit.t('fleet.comms.hidden', { n: 42 })))
    await complete.unmount()
  })
})
