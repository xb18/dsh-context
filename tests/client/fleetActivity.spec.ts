import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { activityBinsOf, countKinds, flowKeyOf, flowsOf, rowInBin, scopeRowsOf } from '../../src/client/fleetActivity'
import type { CommsRow } from '../../src/client/fleetDetail'

const rows: CommsRow[] = [
  { key: 'a', to: 'b', seq: 4, time: 4000, kind: 'settled', from: 'a', text: 'done' },
  { key: 'b', to: 'a', seq: 3, time: 3000, kind: 'relay', from: 'b', text: 'back' },
  { key: 'c', to: 'b', seq: 2, time: 2000, kind: 'mailbox', from: 'a', text: 'mail' },
  { key: 'd', to: 'b', seq: 1, time: 1000, kind: 'relay', from: 'a', text: 'start' },
]

describe('fleet activity model', () => {
  test('directed flows keep direction, chronology and the latest kind', () => {
    const flows = flowsOf(rows)
    assert.equal(flows.length, 2)
    assert.deepEqual(flows.map(flow => [flow.from, flow.to, flow.rows.length, flow.kind]), [
      ['a', 'b', 3, 'settled'],
      ['b', 'a', 1, 'relay'],
    ])
    assert.equal(flowKeyOf(rows[0]), flows[0].key)
    assert.deepEqual(flows[0].rows.map(row => row.key), ['a', 'c', 'd'])
    assert.deepEqual(flows[0].kinds, { relay: 1, mailbox: 1, settled: 1 })
    assert.deepEqual(flows[1].kinds, { relay: 1, mailbox: 0, settled: 0 })
    assert.equal(flows[1].rows[0].key, 'b')
    assert.deepEqual(scopeRowsOf(rows, 'b', null).length, 4)
    assert.deepEqual(scopeRowsOf(rows, null, flows[0].key).map(row => row.key), ['a', 'c', 'd'])
    assert.deepEqual(scopeRowsOf(rows, 'a', flows[1].key).map(row => row.key), ['b'])
    assert.deepEqual(scopeRowsOf(rows, 'missing', flows[0].key), [])
    const tied: CommsRow[] = [
      { key: 'z', to: 'b', seq: 2, time: 5000, kind: 'relay', from: 'a', text: 'z' },
      { key: 'a', to: 'b', seq: 1, time: 5000, kind: 'mailbox', from: 'a', text: 'a' },
      { key: 'back', to: 'a', seq: 1, time: 5000, kind: 'relay', from: 'b', text: 'back' },
    ]
    const tieFlows = flowsOf(tied)
    assert.deepEqual(tieFlows[0].rows.map(row => row.key), ['a', 'z'])
    assert.equal(tieFlows[0].kind, 'mailbox')
    assert.equal(tieFlows[1].from, 'b')
  })

  test('flows tolerate self messages and unknown senders without inventing identities', () => {
    const self: CommsRow[] = [{ key: 'self', to: 'a', seq: 1, time: 1, kind: 'relay', from: 'a', text: 'self' }]
    const unknown: CommsRow[] = [{ key: 'unknown', to: 'a', seq: 2, time: 2, kind: 'mailbox', text: 'unknown' }]
    assert.equal(flowsOf(self)[0].from, 'a')
    assert.equal(flowsOf(unknown)[0].from, '@unknown')
  })

  test('time bins cover every event including the final boundary', () => {
    assert.deepEqual(activityBinsOf([]), [])
    const one = activityBinsOf(rows.slice(0, 1), 4)
    assert.equal(one.length, 1)
    assert.equal(one[0].count, 1)
    assert.equal(rowInBin(rows[0], one[0], true), true)
    const bins = activityBinsOf(rows, 2)
    assert.equal(bins.length, 2)
    assert.equal(bins[0].count + bins[1].count, rows.length)
    assert.equal(bins[1].reports, 1)
    assert.equal(bins[0].messages, 2)
    assert.equal(rowInBin(rows[0], bins[0], false), false)
    assert.equal(rowInBin(rows[0], bins[1], true), true)
    assert.equal(rowInBin(rows[3], bins[0], false), true)
    assert.equal(rowInBin(rows[3], bins[1], true), false)
  })

  test('kind counts include messages, reports and mailbox traffic', () => {
    assert.deepEqual(countKinds(rows), { all: 4, message: 3, report: 1 })
    assert.deepEqual(countKinds([]), { all: 0, message: 0, report: 0 })
  })
})
