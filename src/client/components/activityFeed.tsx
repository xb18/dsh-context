import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { activityBinsOf, countKinds, flowsOf, rowInBin, scopeRowsOf, type FleetFlow } from '../fleetActivity'
import { fromPartyOf, kindGroupOf, type CommsAgent, type CommsKindFilter } from '../commsModel'
import { agentResolverOf } from '../fleetAgents'
import type { CommsRow } from '../fleetDetail'
import type { FleetDetailState } from '../fleetModel'
import { fmtTime } from '../format'
import type { FleetMessage } from '../../shared/types'
import type { ViewKit } from '../viewkit'
import { ClearableInput } from './clearableInput'
import { useRowWindow } from './useRowWindow'
import { CommsEvent, CommsEventDetail } from './commsEvent'
import type { RichKit } from './richText'

export interface ActivityFeedProps {
  sessionId?: string
  details: FleetDetailState
  comms: CommsRow[]
  flows?: readonly FleetFlow[]
  agents: ReadonlyMap<string, CommsAgent>
  titles: ReadonlyMap<string, string>
  attested: ReadonlyMap<string, string>
  selectedId: string | null
  flowKey: string | null
  onClearFlow: () => void
  pinnedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onEnter: (id: string) => void
  rich: RichKit
  t: ViewKit['t']
}

function fullMessageOf(details: FleetDetailState, row: CommsRow | undefined): FleetMessage | null {
  if (row === undefined) return null
  const detail = details.fullLanded.get(row.to)
  return detail?.messages.find(message => message.seq === row.seq && message.kind === row.kind) ?? null
}

function hiddenMessagesOf(details: FleetDetailState, rows: readonly CommsRow[]): number {
  let hidden = 0
  for (const id of new Set(rows.map(row => row.to))) {
    const detail = details.historyLanded.get(id)?.detail ?? details.landed.get(id)?.detail
    if (detail?.messagesTotal !== undefined) hidden += Math.max(0, detail.messagesTotal - detail.messages.length)
  }
  return hidden
}

export function ActivityFeed(props: ActivityFeedProps): ReactElement {
  const { comms, details, t } = props
  const [kind, setKind] = useState<CommsKindFilter>('all')
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const [binStart, setBinStart] = useState<number | null>(null)
  const agentOf = useMemo(
    () => agentResolverOf(props.agents, props.titles, props.attested, t),
    [props.agents, props.titles, props.attested, t],
  )
  const scoped = useMemo(() => scopeRowsOf(comms, props.selectedId, props.flowKey), [comms, props.selectedId, props.flowKey])
  const bins = useMemo(() => activityBinsOf(scoped), [scoped])
  const activeBin = binStart !== null ? bins.find(bin => bin.start === binStart) : undefined
  const counts = useMemo(() => countKinds(scoped), [scoped])
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = scoped.filter((row) => {
      if (kind !== 'all' && kindGroupOf(row) !== kind) return false
      if (activeBin !== undefined && !rowInBin(row, activeBin, activeBin.index === bins.length - 1)) return false
      if (needle === '') return true
      const from = agentOf(fromPartyOf(row))
      const to = agentOf(row.to)
      return [row.text, row.summary, row.report, from.name, to.name]
        .some(value => value !== undefined && value.toLowerCase().includes(needle))
    })
    return order === 'newest' ? filtered : [...filtered].reverse()
  }, [scoped, kind, activeBin, bins.length, query, agentOf, order])
  const openRow = openKey !== null ? rows.find(row => row.key === openKey) : undefined
  const windowed = rows.length >= 60
  const rowRange = useRowWindow(listRef, rows.length, 64, windowed)
  const lastRow = Math.max(0, rows.length - 1)
  const windowFrom = Math.min(rowRange.from, lastRow)
  const windowTo = Math.min(rowRange.to, lastRow)
  const shownRows = windowed ? rows.slice(windowFrom, windowTo + 1) : rows
  const full = fullMessageOf(details, openRow)
  const fullPending = openRow !== undefined && details.fullPending.has(openRow.to)
  const flow = props.flowKey !== null ? (props.flows ?? flowsOf(comms)).find(item => item.key === props.flowKey) : undefined
  const selectedAgent = props.selectedId !== null ? agentOf(props.selectedId) : null
  const maxBin = Math.max(1, ...bins.map(bin => bin.count))
  const clipped = scoped.filter(row => row.clipped === true).length
  const hidden = hiddenMessagesOf(details, scoped)
  const pending = details.pending.size > 0 || details.historyPending.size > 0
  const onScopeClear = flow !== undefined
    ? props.onClearFlow
    : selectedAgent !== null ? () => { props.onSelect(selectedAgent.id) } : undefined
  const scopeLabel = flow !== undefined ? `${agentOf(flow.from).name} → ${agentOf(flow.to).name}` : selectedAgent?.name ?? ''
  const rhythmStart = bins.length === 0 ? 0 : bins[0].start
  const rhythmEnd = bins.length === 0 ? 0 : bins[bins.length - 1].end

  useEffect(() => {
    setKind('all')
    setQuery('')
    setOrder('newest')
    setOpenKey(null)
    setBinStart(null)
  }, [props.sessionId])
  useEffect(() => {
    setOpenKey(null)
    setBinStart(null)
  }, [props.selectedId, props.flowKey])

  const toggle = (row: CommsRow): void => {
    if (openKey === row.key) {
      setOpenKey(null)
      return
    }
    setOpenKey(row.key)
    if (row.clipped === true) details.requestFull(row.to)
  }

  return (
    <section className="lc-card lc-atlas-activity" aria-busy={pending} aria-label={t('fleet.atlas.activity')}>
      <div className="lc-atlas-section-head">
        <div>
          <div className="lc-card-title-text"><IconSendOutlineRegular size={14} />{t('fleet.atlas.activity')}</div>
          <p>{t('fleet.atlas.activitySub', { n: scoped.length })}{pending ? ` · ${t('fleet.comms.loading')}` : ''}</p>
        </div>
        {onScopeClear !== undefined ? (
          <button type="button" className="lc-atlas-scope" onClick={onScopeClear}>
            {scopeLabel} ×
          </button>
        ) : null}
      </div>
      {bins.length > 0 ? (
        <div className="lc-atlas-rhythm">
          <div className="lc-atlas-rhythm-label"><span>{t('fleet.atlas.rhythm')}</span><time>{fmtTime(rhythmStart)} — {fmtTime(rhythmEnd)}</time></div>
          <div className="lc-atlas-bins" role="group" aria-label={t('fleet.atlas.rhythm')}>
            {bins.map(bin => (
              <button
                type="button"
                key={bin.index}
                className={binStart === bin.start ? 'lc-atlas-bin-on' : ''}
                aria-pressed={binStart === bin.start}
                title={`${fmtTime(bin.start)} · ${t('fleet.atlas.bin', { n: bin.count, r: bin.reports })}`}
                onClick={() => {
                  setBinStart(current => current === bin.start ? null : bin.start)
                  setOpenKey(null)
                }}
              >
                <i style={{ height: `${Math.max(8, bin.count / maxBin * 100)}%` }}><b style={{ height: `${bin.count === 0 ? 0 : bin.reports / bin.count * 100}%` }} /></i>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="lc-fleet-toolbar">
        <div className="lc-fleet-filters" role="group" aria-label={t('fleet.comms.kindGroup')}>
          {(['all', 'message', 'report'] as const).map(key => (
            <button type="button" key={key} className={'lc-gran-btn' + (kind === key ? ' lc-gran-on' : '')} aria-pressed={kind === key} onClick={() => { setKind(key); setOpenKey(null) }}>
              {t(`fleet.comms.kind.${key}`)}<span className="lc-kind-n">{counts[key]}</span>
            </button>
          ))}
        </div>
        <ClearableInput type="search" className="lc-fleet-search" placeholder={t('fleet.comms.search')} clearLabel={t('field.clear')} value={query} onChange={setQuery} />
        <button type="button" className="lc-gran-btn lc-comms-order" onClick={() => { setOrder(current => current === 'newest' ? 'oldest' : 'newest') }}>
          {t(order === 'newest' ? 'fleet.comms.orderNewest' : 'fleet.comms.orderOldest')}
        </button>
      </div>
      {comms.length === 0 && (pending || details.landed.size === 0) ? (
        <div className="lc-comms-skeleton" role="status" aria-label={t('fleet.comms.loading')}><i /><i /><i /></div>
      ) : comms.length === 0 ? <div className="lc-empty">{t('fleet.comms.empty')}</div>
        : rows.length === 0 ? <div className="lc-empty">{t('fleet.comms.noMatch')}</div> : null}
      <ul className="lc-comms-list lc-atlas-event-list" ref={listRef} hidden={rows.length === 0}>
        {windowed && windowFrom > 0 ? <li aria-hidden="true" style={{ height: windowFrom * 64 }} /> : null}
        {shownRows.map(row => (
          <CommsEvent
            key={row.key}
            row={row}
            agentOf={agentOf}
            open={openKey === row.key}
            onToggle={() => { toggle(row) }}
            full={openKey === row.key ? full : null}
            t={t}
          >
            {openKey === row.key ? (
              <CommsEventDetail
                row={row}
                agentOf={agentOf}
                full={full}
                fullPending={fullPending}
                pinnedId={props.pinnedId}
                onSelect={props.onSelect}
                onOpen={props.onOpen}
                onEnter={props.onEnter}
                onClose={() => { setOpenKey(null) }}
                rich={props.rich}
                t={t}
              />
            ) : null}
          </CommsEvent>
        ))}
        {windowed && windowTo < lastRow ? <li aria-hidden="true" style={{ height: (lastRow - windowTo) * 64 }} /> : null}
      </ul>
      {rows.length < scoped.length || clipped > 0 || hidden > 0 ? (
        <div className="lc-comms-notes">
          {rows.length < scoped.length ? <span>{t('fleet.comms.filtered', { n: rows.length, total: scoped.length })}</span> : null}
          {clipped > 0 ? <span>{t('fleet.comms.clipped', { n: clipped })}</span> : null}
          {hidden > 0 ? <span>{t('fleet.comms.hidden', { n: hidden })}</span> : null}
        </div>
      ) : null}
    </section>
  )
}
