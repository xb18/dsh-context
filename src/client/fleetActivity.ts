import { fromPartyOf, kindGroupOf, type CommsKindFilter } from './commsModel'
import type { CommsRow } from './fleetDetail'

export interface FleetFlow {
  key: string
  from: string
  to: string
  rows: CommsRow[]
  lastTime: number
  kind: CommsRow['kind']
  kinds: Record<CommsRow['kind'], number>
}

export interface ActivityBin {
  index: number
  start: number
  end: number
  count: number
  messages: number
  reports: number
}

const FLOW_SEP = '\u0000'

export function flowKeyOf(row: CommsRow): string {
  return `${fromPartyOf(row)}${FLOW_SEP}${row.to}`
}

export function flowsOf(rows: readonly CommsRow[]): FleetFlow[] {
  const groups = new Map<string, CommsRow[]>()
  for (const row of rows) {
    const key = flowKeyOf(row)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [row])
    else group.push(row)
  }
  const flows: FleetFlow[] = []
  for (const [key, group] of groups) {
    group.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key))
    const latest = group[0]
    const kinds: Record<CommsRow['kind'], number> = { relay: 0, mailbox: 0, settled: 0 }
    for (const row of group) kinds[row.kind] += 1
    flows.push({ key, from: fromPartyOf(latest), to: latest.to, rows: group, lastTime: latest.time, kind: latest.kind, kinds })
  }
  return flows.sort((a, b) => b.lastTime - a.lastTime || a.key.localeCompare(b.key))
}

export function activityBinsOf(rows: readonly CommsRow[], limit = 18): ActivityBin[] {
  if (rows.length === 0) return []
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    first = Math.min(first, row.time)
    last = Math.max(last, row.time)
  }
  const count = Math.max(1, Math.min(limit, rows.length))
  const span = Math.max(1, last - first)
  const bins: ActivityBin[] = Array.from({ length: count }, (_, index) => ({
    index,
    start: first + span * index / count,
    end: first + span * (index + 1) / count,
    count: 0,
    messages: 0,
    reports: 0,
  }))
  for (const row of rows) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((row.time - first) / span * count)))
    const bin = bins[index]
    bin.count += 1
    if (kindGroupOf(row) === 'report') bin.reports += 1
    else bin.messages += 1
  }
  return bins
}

export function rowInBin(row: CommsRow, bin: ActivityBin, last: boolean): boolean {
  return row.time >= bin.start && (last ? row.time <= bin.end : row.time < bin.end)
}

export function scopeRowsOf(rows: readonly CommsRow[], agentId: string | null, flowKey: string | null): CommsRow[] {
  return rows.filter((row) => {
    if (flowKey !== null && flowKeyOf(row) !== flowKey) return false
    if (agentId !== null && fromPartyOf(row) !== agentId && row.to !== agentId) return false
    return true
  })
}

export function countKinds(rows: readonly CommsRow[]): Record<CommsKindFilter, number> {
  const counts: Record<CommsKindFilter, number> = { all: rows.length, message: 0, report: 0 }
  for (const row of rows) counts[kindGroupOf(row)] += 1
  return counts
}
