import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { IconWorkspaceTreeOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentForest, AgentNode } from '../agentTree'
import { BRAND_HUE, familyHue, fmtDurationCompact } from '../agentTree'
import { atlasFlowsOf, atlasLayoutOf, atlasViewOf, type AtlasPoint } from '../atlasModel'
import { avatarLabelsOf, fromPartyOf, type CommsAgent } from '../commsModel'
import { agentResolverOf } from '../fleetAgents'
import { flowsOf, type FleetFlow } from '../fleetActivity'
import type { CommsRow } from '../fleetDetail'
import { teamMemberOf, type FleetTeam } from '../fleetTeam'
import { scrollIntoViewIfPossible } from '../revealScroll'
import type { ViewKit } from '../viewkit'
import { ClearableInput } from './clearableInput'
import { AgentAvatar } from './commsAgent'

export interface AtlasGraphProps {
  sessionId?: string
  forest: AgentForest
  team: FleetTeam | null
  comms: CommsRow[]
  flows?: readonly FleetFlow[]
  agents: ReadonlyMap<string, CommsAgent>
  titles: ReadonlyMap<string, string>
  attested: ReadonlyMap<string, string>
  selectedId: string | null
  hoverId: string | null
  focusId: string | null
  flowKey: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onFlow: (key: string | null) => void
  t: ViewKit['t']
}

function controlPath(from: AtlasPoint, to: AtlasPoint): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const bend = Math.max(18, (y2 - y1) * 0.45)
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`
}

function flowPath(from: AtlasPoint, to: AtlasPoint): string {
  const forward = from.x <= to.x
  const x1 = from.x + (forward ? from.width : 0)
  const y1 = from.y + from.height / 2
  const x2 = to.x + (forward ? 0 : to.width)
  const y2 = to.y + to.height / 2
  const lift = Math.min(120, 28 + Math.abs(x2 - x1) * 0.12)
  return `M ${x1} ${y1} C ${x1 + (forward ? lift : -lift)} ${y1 - lift}, ${x2 + (forward ? -lift : lift)} ${y2 - lift}, ${x2} ${y2}`
}

function hueOf(team: FleetTeam | null, node: AgentNode): string {
  const members = team?.members ?? []
  const member = teamMemberOf(team, node.id)
  if (member?.role === 'lead' || node.isCurrent) return BRAND_HUE
  if (member !== null) return familyHue(members.indexOf(member))
  return familyHue(node.family)
}

export function AtlasGraph(props: AtlasGraphProps): ReactElement {
  const { forest, team, comms, t } = props
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [compact, setCompact] = useState(forest.nodes.length > 18)
  const [query, setQuery] = useState('')
  const [stageWidth, setStageWidth] = useState(0)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const agentOf = useMemo(
    () => agentResolverOf(props.agents, props.titles, props.attested, t),
    [props.agents, props.titles, props.attested, t],
  )
  const derivedFlows = useMemo(() => flowsOf(comms), [comms])
  const flows = props.flows ?? derivedFlows
  const entries = useMemo(
    () => atlasViewOf(forest, expanded, showAll, props.selectedId),
    [forest, expanded, showAll, props.selectedId],
  )
  const layout = useMemo(() => atlasLayoutOf(entries, stageWidth, compact), [entries, stageWidth, compact])
  const flowLinks = useMemo(() => atlasFlowsOf(layout.points, flows), [layout.points, flows])
  const avatarLabels = useMemo(() => avatarLabelsOf(
    forest.nodes.map(node => ({ id: node.id, name: agentOf(node.id).name })),
  ), [forest.nodes, agentOf])
  const traffic = useMemo(() => {
    const map = new Map<string, { incoming: number; outgoing: number }>()
    for (const row of comms) {
      const from = fromPartyOf(row)
      const sender = map.get(from) ?? { incoming: 0, outgoing: 0 }
      sender.outgoing += 1
      map.set(from, sender)
      const recipient = map.get(row.to) ?? { incoming: 0, outgoing: 0 }
      recipient.incoming += 1
      map.set(row.to, recipient)
    }
    return map
  }, [comms])
  const groupsOpen = showAll || expanded.size > 0
  const allTasks = team?.tasks ?? []
  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => needle === '' ? [] : forest.nodes.filter((node) => {
    const agent = agentOf(node.id)
    return `${agent.name} ${agent.description ?? ''} ${node.label}`.toLowerCase().includes(needle)
  }), [needle, forest.nodes, agentOf])
  const matchIds = new Set(matches.map(node => node.id))
  const activeId = props.hoverId ?? props.selectedId ?? props.focusId
  const related = new Set<string>()
  if (activeId !== null) {
    related.add(activeId)
    for (const edge of forest.edges) {
      if (edge.from === activeId) related.add(edge.to)
      if (edge.to === activeId) related.add(edge.from)
    }
    for (const flow of flows) {
      if (flow.from !== activeId && flow.to !== activeId) continue
      for (const row of flow.rows) {
        related.add(fromPartyOf(row))
        related.add(row.to)
      }
    }
  }

  useEffect(() => {
    setExpanded(new Set())
    setShowAll(false)
    setCompact(forest.nodes.length > 18)
    setQuery('')
  }, [props.sessionId])
  useEffect(() => {
    const el = stageRef.current
    if (el === null || typeof ResizeObserver !== 'function') return undefined
    const write = (): void => { setStageWidth(el.clientWidth) }
    const observer = new ResizeObserver(([entry]) => { setStageWidth(entry.contentRect.width) })
    observer.observe(el)
    window.addEventListener('resize', write)
    write()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', write)
    }
  }, [])
  useEffect(() => {
    if (props.focusId === null) return
    setShowAll(true)
  }, [props.focusId])
  useEffect(() => {
    const id = props.focusId ?? props.selectedId
    if (id === null) return
    const card = stageRef.current?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(id)}"]`)
    scrollIntoViewIfPossible(card ?? null, { block: 'nearest', behavior: 'smooth' })
  }, [props.focusId, props.selectedId, layout.points])

  const selectMatch = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key !== 'Enter' || matches.length === 0) return
    ev.preventDefault()
    setShowAll(true)
    const first = matches[0]
    if (props.selectedId !== first.id) props.onSelect(first.id)
  }
  const keySelect = (id: string) => (ev: KeyboardEvent<HTMLElement>): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    props.onSelect(id)
  }
  const flowSelect = (flow: FleetFlow, ev: KeyboardEvent<SVGPathElement>): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    props.onFlow(props.flowKey === flow.key ? null : flow.key)
  }

  return (
    <section className="lc-card lc-atlas-graph" aria-label={t('fleet.atlas.graph')}>
      <div className="lc-atlas-section-head">
        <div>
          <div className="lc-card-title-text"><IconWorkspaceTreeOutlineRegular size={15} />{t('fleet.atlas.graph')}</div>
          <p>{t('fleet.atlas.graphSub')}</p>
        </div>
        <div className="lc-atlas-graph-tools">
          <ClearableInput
            type="search"
            className="lc-fleet-search"
            value={query}
            onChange={setQuery}
            onKeyDown={selectMatch}
            placeholder={t('fleet.atlas.find')}
            clearLabel={t('field.clear')}
          />
          <button type="button" className="lc-gran-btn" aria-pressed={compact} onClick={() => { setCompact(value => !value) }}>
            {t(compact ? 'fleet.atlas.comfort' : 'fleet.atlas.compact')}
          </button>
          {forest.nodes.length > 18 ? (
            <button
              type="button"
              className="lc-gran-btn"
              aria-expanded={groupsOpen}
              onClick={() => {
                setShowAll(!groupsOpen)
                setExpanded(new Set())
              }}
            >
              {t(groupsOpen ? 'fleet.atlas.fold' : 'fleet.atlas.showAll')}
            </button>
          ) : null}
        </div>
      </div>
      <div className="lc-atlas-legend" aria-label={t('fleet.atlas.legend')}>
        <span><i className="lc-atlas-key-control" />{t('fleet.atlas.control')}</span>
        <span><i className="lc-atlas-key-relay" />{t('fleet.kind.relay')}</span>
        <span><i className="lc-atlas-key-mailbox" />{t('fleet.kind.mailbox')}</span>
        <span><i className="lc-atlas-key-settled" />{t('fleet.kind.settled')}</span>
      </div>
      <div className="lc-atlas-stage" ref={stageRef}>
        <div className="lc-atlas-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="lc-atlas-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
            <defs>
              <marker id="lc-atlas-arrow-relay" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" /></marker>
              <marker id="lc-atlas-arrow-mailbox" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" /></marker>
              <marker id="lc-atlas-arrow-settled" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" /></marker>
            </defs>
            {layout.controls.map(link => (
              <path key={link.key} className="lc-atlas-control-link" d={controlPath(link.from, link.to)} />
            ))}
            {flowLinks.map((link) => {
              const selected = props.flowKey === link.flow.key
              const dimmed = props.flowKey !== null && !selected
              const d = flowPath(link.from, link.to)
              const stats = (['relay', 'mailbox', 'settled'] as const)
                .filter(kind => link.flow.kinds[kind] > 0)
                .map(kind => `${link.flow.kinds[kind]} ${t(`fleet.kind.${kind}`)}`)
                .join(' · ')
              const label = `${agentOf(link.flow.from).name} → ${agentOf(link.flow.to).name} · ${stats}`
              return (
                <g key={link.flow.key} className={`lc-atlas-flow lc-atlas-flow-${link.flow.kind}${selected ? ' lc-atlas-flow-on' : ''}${dimmed ? ' lc-atlas-flow-dim' : ''}`}>
                  <path className="lc-atlas-flow-line" d={d} markerEnd={`url(#lc-atlas-arrow-${link.flow.kind})`} />
                  <path
                    className="lc-atlas-flow-hit"
                    d={d}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={selected}
                    onClick={() => { props.onFlow(selected ? null : link.flow.key) }}
                    onKeyDown={(ev) => { flowSelect(link.flow, ev) }}
                  ><title>{label}</title></path>
                </g>
              )
            })}
          </svg>
          {layout.points.map((point) => {
            if (point.node === null) {
              const parentId = point.parentId
              return (
                <button
                  type="button"
                  key={point.id}
                  className="lc-atlas-cluster"
                  style={{ left: point.x, top: point.y, width: point.width, height: point.height }}
                  data-cluster={parentId}
                  onClick={() => {
                    const next = new Set(expanded)
                    next.add(parentId)
                    setExpanded(next)
                  }}
                >
                  <b>+{point.hidden.length}</b>
                  <span>{t('fleet.atlas.more')}</span>
                </button>
              )
            }
            const node = point.node
            const agent = agentOf(node.id)
            const hue = hueOf(team, node)
            const count = traffic.get(node.id) ?? { incoming: 0, outgoing: 0 }
            const member = teamMemberOf(team, node.id)
            const tasks = member === null ? [] : allTasks.filter(task => task.ownerName === member.name)
            const done = tasks.filter(task => task.status === 'completed').length
            const cls = 'lc-atlas-node'
              + (props.selectedId === node.id ? ' lc-atlas-node-selected' : '')
              + (props.hoverId === node.id || props.focusId === node.id ? ' lc-atlas-node-hover' : '')
              + (activeId !== null && !related.has(node.id) ? ' lc-atlas-node-dim' : '')
              + (needle !== '' && !matchIds.has(node.id) ? ' lc-atlas-node-dim' : '')
            const state = node.running ? 'ongoing' : node.completed ? 'done' : 'idle'
            return (
              <div
                key={node.id}
                className={cls}
                style={{ left: point.x, top: point.y, width: point.width, height: point.height, '--lc-member-hue': hue } as CSSProperties}
                data-agent={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={props.selectedId === node.id}
                onClick={() => { props.onSelect(node.id) }}
                onKeyDown={keySelect(node.id)}
                onMouseEnter={() => { props.onHover(node.id) }}
                onMouseLeave={() => { props.onHover(null) }}
                onFocus={() => { props.onHover(node.id) }}
                onBlur={() => { props.onHover(null) }}
              >
                <div className="lc-atlas-node-head">
                  <AgentAvatar agent={{ ...agent, hue, initials: avatarLabels.get(node.id) }} size="sm" t={t} />
                  <span className="lc-atlas-node-name" title={agent.description ?? agent.name}>{agent.name}</span>
                  <StateDot state={state} size={8} />
                </div>
                <div className="lc-atlas-node-meta">
                  <span>{node.running ? t('agents.running') : node.completed ? t('fleet.atlas.turnDone') : t('fleet.filter.idle')}</span>
                  {tasks.length > 0 ? <span>{done}/{tasks.length} {t('fleet.atlas.tasks')}</span> : null}
                  {count.incoming + count.outgoing > 0 ? <span>↙{count.incoming} ↗{count.outgoing}</span> : null}
                  {tasks.length === 0 && count.incoming + count.outgoing === 0 && node.durationMs !== null
                    ? <span>{fmtDurationCompact(node.durationMs)}</span>
                    : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {forest.solo ? <div className="lc-empty">{t('agents.solo')}</div> : null}
    </section>
  )
}
