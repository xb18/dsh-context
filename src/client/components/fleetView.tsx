import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentHeads } from '../agentHeads'
import { agentSelfOf, type AgentForest, type AgentNode } from '../agentTree'
import { attestedNamesOf, commsAgentsOf, agentResolverOf } from '../fleetAgents'
import { mergeComms } from '../fleetDetail'
import { flowsOf } from '../fleetActivity'
import { useFleetDetails, useFleetModel } from '../fleetModel'
import { teamOf } from '../fleetTeam'
import { fmtTime } from '../format'
import type { ClientCtx, SessionStandardProps } from '../services'
import { CONTEXT_VIEW_ID, openChildAsideVia, openSessionVia, projectionOf, seedConversationViewVia, unsupportedOf } from '../services'
import { useFleetMemberFocus } from '../viewFocus'
import { useContextSession } from '../sessionData'
import type { ViewKit } from '../viewkit'
import type { FleetDetail } from '../../shared/types'
import { ActivityFeed } from './activityFeed'
import { AtlasGraph } from './atlasGraph'
import { makeDetailNote } from './detailNote'
import { makeRichText } from './richText'
import { makeErrorBoundary } from './errorBoundary'
import { FleetAgentDetail } from './fleetAgentDetail'
import { FleetWork, workItemsOf } from './fleetWork'
import { makeUpgradeGate } from './upgradeGate'
import { useConversationSurface } from './useConversationSurface'
import { scrollIntoViewIfPossible } from '../revealScroll'

function withRoster(forest: AgentForest | null, team: ReturnType<typeof teamOf>): AgentForest | null {
  if (forest === null || team === null) return forest
  const missing = team.members.filter(member => !forest.nodes.some(node => node.id === member.id))
  if (missing.length === 0) return forest
  const additions: AgentNode[] = missing.map(member => ({
    id: member.id,
    label: member.name,
    depth: 0,
    family: team.members.indexOf(member),
    isCurrent: false,
    running: false,
    completed: false,
    subagent: false,
    updatedAt: 0,
    head: null,
    requests: 0,
    billed: null,
    costUsage: null,
    durationMs: null,
    identity: null,
  }))
  return { ...forest, nodes: [...forest.nodes, ...additions], solo: false }
}

export function makeFleetView(
  ctx: ClientCtx,
  kit: ViewKit,
  heads: AgentHeads,
): (props: SessionStandardProps) => ReactElement {
  const { t } = kit
  const UpgradeGate = makeUpgradeGate(kit)
  const DetailNote = makeDetailNote(kit)
  const ErrorBoundary = makeErrorBoundary(t)
  const rich = makeRichText(kit)

  function FleetBody(props: SessionStandardProps): ReactElement {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
    const { source, data, pressure, breakdown, usage } = useContextSession(props)
    const rootRef = useRef<HTMLDivElement | null>(null)
    useConversationSurface(rootRef)
    useLayoutEffect(() => {
      /* v8 ignore next 3 */
      const scroller = rootRef.current !== null
        ? rootRef.current.closest('[data-conversation-scroll]')
        : null
      if (scroller !== null) scroller.scrollTop = 0
    }, [sessionId])
    const self = data !== null ? agentSelfOf(data, pressure, breakdown, usage) : undefined
    const model = useFleetModel(ctx, heads, sessionId, self, data !== null, 120)
    const teamDirect = projectionOf(props, 'agentTeam', teamOf)
    const team = teamDirect ?? model.team
    const forest = useMemo(() => withRoster(model.forest, team), [model.forest, team])
    const details = useFleetDetails(undefined, { concurrency: 4, refreshDelayMs: 750, scopeKey: sessionId })
    const [hoverId, setHoverId] = useState<string | null>(null)
    const [pinnedId, setPinnedId] = useState<string | null>(null)
    const [flowKey, setFlowKey] = useState<string | null>(null)
    const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
    const focusMember = useFleetMemberFocus(sessionId)
    const byId = useMemo(() => new Map((forest?.nodes ?? []).map(node => [node.id, node])), [forest])
    const workItems = useMemo(() => workItemsOf(team, forest), [team, forest])

    useEffect(() => {
      if (pinnedId !== null && !byId.has(pinnedId)) setPinnedId(null)
    }, [pinnedId, byId])
    useEffect(() => { setFlowKey(null) }, [sessionId])
    const detailNodes = useMemo(
      () => forest?.nodes ?? (team?.members ?? []).map(member => ({ id: member.id, updatedAt: 0 })),
      [forest, team],
    )
    const detailStamp = detailNodes.map(node => `${node.id}@${node.updatedAt}`).join(',')
    useEffect(() => {
      for (const node of detailNodes) {
        details.request(node.id, node.updatedAt)
        details.requestHistory(node.id, node.updatedAt)
      }
    }, [detailNodes, detailStamp])
    const landedDetails = useMemo(() => {
      const map = new Map<string, FleetDetail>()
      for (const node of detailNodes) {
        const history = details.historyLanded.get(node.id)?.detail
        if (history !== undefined && history !== null) {
          map.set(node.id, history)
          continue
        }
        const preview = details.landed.get(node.id)?.detail
        if (preview !== undefined && preview !== null) map.set(node.id, preview)
      }
      return map
    }, [detailNodes, details.landed, details.historyLanded])
    const comms = useMemo(() => mergeComms(landedDetails), [landedDetails])
    const flows = useMemo(() => flowsOf(comms), [comms])
    const attestedNames = useMemo(() => attestedNamesOf(comms), [comms])
    const leadId = team?.members[0]?.id
    const leadDetail = leadId !== undefined ? landedDetails.get(leadId) ?? null : null
    const agents = useMemo(
      () => commsAgentsOf(forest?.nodes ?? [], team, leadDetail?.roster, attestedNames, t),
      [attestedNames, forest, leadDetail, team, t],
    )
    const agentOf = useMemo(() => agentResolverOf(agents, model.titles, attestedNames, t), [agents, model.titles, attestedNames, t])

    const open = (id: string): void => {
      const node = byId.get(id)
      /* v8 ignore next 5 */
      if (openChildAsideVia(ctx, {
        childSessionId: id,
        parentSessionId: node?.parentId,
        mode: node?.identity?.mode,
      })) return
      openSessionVia(ctx, id)
    }
    const enter = (id: string): void => {
      seedConversationViewVia(id, CONTEXT_VIEW_ID)
      openSessionVia(ctx, id)
    }
    const select = (id: string): void => {
      setPinnedId(current => current === id ? null : id)
      setFlowKey(null)
    }
    const chooseFlow = (key: string | null): void => {
      setFlowKey(key)
      if (key === null) return
      const flow = flows.find(item => item.key === key)
      /* v8 ignore next 1 */
      if (flow !== undefined) setPinnedId(flow.from)
    }
    const focusTask = (id: string | null): void => {
      if (id !== null) setFlowKey(null)
      if (id !== null && pinnedId !== null && !workItems.some(work => work.id === id && work.ownerId === pinnedId)) {
        setPinnedId(null)
      }
      setFocusTaskId(id)
    }
    useEffect(() => {
      if (focusTaskId === null) return
      const card = rootRef.current?.querySelector<HTMLElement>(`[data-task="${CSS.escape(focusTaskId)}"]`)
      scrollIntoViewIfPossible(card ?? null, { block: 'nearest', behavior: 'smooth' })
    }, [focusTaskId, pinnedId])

    if (data === null) {
      return (
        <div className="lc-root" ref={rootRef}>
          {source.detailState === 'failed'
            ? <DetailNote state="failed" onRetry={source.retryDetail} />
            : <div className="lc-empty">{t('loading')}</div>}
        </div>
      )
    }

    const latestTime = comms.length > 0 ? comms[0].time : null
    const gate = unsupportedOf(data.unsupported)
    const inspected = pinnedId !== null
      ? byId.get(pinnedId)
      : focusMember !== null
        ? byId.get(focusMember)
        : forest?.nodes.find(node => node.isCurrent) ?? forest?.nodes[0]
    const running = forest === null ? null : forest.nodes.filter(node => node.running).length
    const taskTotal = team?.tasks.length ?? 0
    const done = (team?.tasks ?? []).filter(task => task.status === 'completed').length
    const agentCount = forest?.nodes.length ?? team?.members.length ?? 0
    /* v8 ignore next 1 */
    const agentDetail = inspected === undefined ? null : (
      <FleetAgentDetail
        node={inspected}
        agent={agentOf(inspected.id)}
        pinned={pinnedId === inspected.id}
        team={team}
        detail={details.landed.get(inspected.id)}
        roster={leadDetail?.roster ?? []}
        comms={comms}
        agentOf={agentOf}
        onSelect={select}
        onClear={() => { setPinnedId(null) }}
        onOpen={open}
        onEnter={enter}
        onFlow={chooseFlow}
        onFocusTask={focusTask}
        t={t}
        fmt={kit.fmt}
      />
    )
    return (
      <div className="lc-root lc-atlas-root" ref={rootRef}>
        <header className="lc-atlas-overview">
          <div className="lc-atlas-heading">
            <span>{t('fleet.atlas.eyebrow')}</span>
            <h1>{t('fleet.atlas.title')}</h1>
            <p>{t('fleet.atlas.subtitle')}</p>
          </div>
          <dl className="lc-atlas-metrics">
            <div><dt>{t('fleet.atlas.metric.agents')}</dt><dd>{kit.fmt(agentCount)}</dd><span>{running === null ? '—' : t('fleet.atlas.metric.running', { n: running })}</span></div>
            <div><dt>{t('fleet.atlas.metric.work')}</dt><dd>{taskTotal === 0 ? '—' : `${done}/${taskTotal}`}</dd><span>{t('fleet.atlas.metric.workSub')}</span></div>
            <div><dt>{t('fleet.atlas.metric.messages')}</dt><dd>{kit.fmt(comms.length)}</dd><span>{t('fleet.atlas.metric.messagesSub')}</span></div>
            <div><dt>{t('fleet.atlas.metric.latest')}</dt><dd className="lc-atlas-time">{latestTime === null ? '—' : fmtTime(latestTime)}</dd><span>{t('fleet.atlas.metric.latestSub')}</span></div>
          </dl>
        </header>
        {forest !== null ? (
          <div className="lc-atlas-primary">
            <AtlasGraph
              sessionId={sessionId}
              forest={forest}
              team={team}
              comms={comms}
              flows={flows}
              agents={agents}
              titles={model.titles}
              attested={attestedNames}
              selectedId={pinnedId}
              hoverId={hoverId}
              focusId={focusMember}
              flowKey={flowKey}
              onSelect={select}
              onHover={setHoverId}
              onFlow={chooseFlow}
              t={t}
            />
            {agentDetail}
          </div>
        ) : null}
        <div className="lc-atlas-lower">
          <FleetWork
            team={team}
            forest={forest}
            details={details}
            selectedId={pinnedId}
            focusTaskId={focusTaskId}
            agentOf={agentOf}
            onSelect={select}
            onFocusTask={focusTask}
            t={t}
          />
          {forest !== null || team !== null ? (
            <ActivityFeed
              sessionId={sessionId}
              details={details}
              comms={comms}
              flows={flows}
              agents={agents}
              titles={model.titles}
              attested={attestedNames}
              selectedId={pinnedId}
              flowKey={flowKey}
              onClearFlow={() => { chooseFlow(null) }}
              pinnedId={pinnedId}
              onSelect={select}
              onOpen={open}
              onEnter={enter}
              rich={rich}
              t={t}
            />
          ) : null}
        </div>
        <div className="lc-foot">{t('fleet.atlas.note')}</div>
        {gate !== null ? <UpgradeGate sessionId={sessionId} current={gate.current} minimum={gate.minimum} /> : null}
      </div>
    )
  }

  return function FleetView(props: SessionStandardProps): ReactElement {
    return h(ErrorBoundary, null, h(FleetBody, props))
  }
}
