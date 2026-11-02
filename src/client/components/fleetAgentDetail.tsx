import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { IconPanelLeftOutlineRegular, IconRightUpOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentNode } from '../agentTree'
import { fmtDurationCompact, modelLabelOf } from '../agentTree'
import type { CommsAgent } from '../commsModel'
import { flowsOf, type FleetFlow } from '../fleetActivity'
import type { CommsRow } from '../fleetDetail'
import { tasksOfOwner, teamMemberOf, type FleetTeam } from '../fleetTeam'
import { fmtTime } from '../format'
import type { FleetDetail, FleetMemberInfo } from '../../shared/types'
import type { ViewKit } from '../viewkit'
import { AgentAvatar } from './commsAgent'

export interface FleetAgentDetailProps {
  node: AgentNode
  agent: CommsAgent
  pinned: boolean
  team: FleetTeam | null
  detail: { detail: FleetDetail | null } | undefined
  roster: readonly FleetMemberInfo[]
  comms: CommsRow[]
  flows?: readonly FleetFlow[]
  agentOf: (id: string) => CommsAgent
  onSelect: (id: string) => void
  onClear: () => void
  onOpen: (id: string) => void
  onEnter: (id: string) => void
  onFlow: (key: string | null) => void
  onFocusTask: (id: string) => void
  t: ViewKit['t']
  fmt: ViewKit['fmt']
}

export function FleetAgentDetail(props: FleetAgentDetailProps): ReactElement {
  const { node, agent, team, t } = props
  const [promptOpen, setPromptOpen] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  useEffect(() => {
    setPromptOpen(false)
    setReplyOpen(false)
  }, [node.id])
  const member = teamMemberOf(team, node.id)
  const tasks = tasksOfOwner(team, member?.name)
  const detail = props.detail?.detail ?? null
  const info = member !== null ? props.roster.find(entry => entry.name === member.name) : undefined
  const model = modelLabelOf(node.model, node.reasoningEffort)
    ?? modelLabelOf(detail?.descriptor?.agentModel, detail?.descriptor?.agentReasoningEffort)
  const allFlows = (props.flows ?? flowsOf(props.comms)).filter(flow => flow.from === node.id || flow.to === node.id)
  const flows = allFlows.slice(0, 4)
  const state = node.running ? 'ongoing' : node.completed ? 'done' : member?.phase === 'failed' ? 'error' : 'idle'
  const role = member?.role ?? (node.isCurrent ? 'agent' : 'subagent')
  const parentId = node.parentId
  return (
    <aside className="lc-card lc-atlas-detail" aria-label={t('fleet.atlas.detail')}>
      <div className="lc-atlas-detail-hero" style={{ '--lc-member-hue': agent.hue } as CSSProperties}>
        <AgentAvatar agent={agent} size="lg" t={t} />
        <div className="lc-atlas-detail-title">
          <div><StateDot state={state} size={9} /><h2>{agent.name}</h2></div>
          <p>{agent.description ?? t(`fleet.role.${role}`)}</p>
        </div>
        <span className="lc-atlas-detail-actions">
          {props.pinned ? <button type="button" className="lc-inspector-btn" onClick={props.onClear}>{t('fleet.comms.detail.unfilter')}</button> : null}
          {!node.isCurrent ? (
            <>
              <button type="button" className="lc-inspector-btn" title={t('fleet.openSidebar')} aria-label={t('fleet.openSidebar')} onClick={() => { props.onOpen(node.id) }}><IconPanelLeftOutlineRegular size={12} /></button>
              <button type="button" className="lc-inspector-btn" title={t('fleet.open')} aria-label={t('fleet.open')} onClick={() => { props.onEnter(node.id) }}><IconRightUpOutlineRegular size={12} /></button>
            </>
          ) : null}
        </span>
      </div>
      <div className="lc-atlas-detail-tags">
        <span>{t(`fleet.role.${role}`)}</span>
        {node.identity !== null ? <span>{t(node.identity.mode === 'one-shot' ? 'agents.oneshot' : 'agents.continuable')}</span> : null}
        {member !== null && member.phase !== 'active' ? <span>{t(`fleet.phase.${member.phase}`)}</span> : null}
      </div>
      <dl className="lc-atlas-facts">
        <div><dt>{t('fleet.atlas.state')}</dt><dd>{t(node.running ? 'fleet.filter.running' : node.completed ? 'fleet.atlas.turnDone' : 'fleet.filter.idle')}</dd></div>
        {node.durationMs !== null ? <div><dt>{t('fleet.atlas.duration')}</dt><dd>{fmtDurationCompact(node.durationMs)}</dd></div> : null}
        {node.requests > 0 ? <div><dt>{t('fleet.atlas.steps')}</dt><dd>{props.fmt(node.requests)}</dd></div> : null}
        {model !== undefined ? <div><dt>{t('fleet.atlas.model')}</dt><dd title={model}>{model}</dd></div> : null}
      </dl>
      {parentId !== undefined ? (
        <button type="button" className="lc-atlas-parent" onClick={() => { props.onSelect(parentId) }}>
          {t('fleet.atlas.parent')}<b>{props.agentOf(parentId).name}</b>
        </button>
      ) : null}
      {info !== undefined && info.description !== '' ? <p className="lc-atlas-duty">{info.description}</p> : null}
      {member?.error !== undefined ? <p className="lc-atlas-error">{member.error}</p> : null}
      {tasks.length > 0 ? (
        <section className="lc-atlas-detail-section">
          <h3>{t('fleet.atlas.assigned')}<span>{tasks.filter(task => task.status === 'completed').length}/{tasks.length}</span></h3>
          <div className="lc-atlas-assigned">
            {tasks.map(task => (
              <button type="button" key={task.id} data-detail-task={task.id} onClick={() => { props.onFocusTask(task.id) }}>
                <StateDot state={task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'ongoing' : task.ready ? 'idle' : 'warning'} size={8} />
                <span>{task.subject}</span>
                <em>{t(`fleet.task.${task.status}`)}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {flows.length > 0 ? (
        <section className="lc-atlas-detail-section">
          <h3>{t('fleet.atlas.connections')}<span>{allFlows.length}</span></h3>
          <div className="lc-atlas-connections">
            {flows.map((flow) => {
              const outgoing = flow.from === node.id
              const peer = props.agentOf(outgoing ? flow.to : flow.from)
              return (
                <button type="button" key={flow.key} onClick={() => { props.onFlow(flow.key) }}>
                  <span>{outgoing ? '↗' : '↙'} {peer.name}</span><em>{flow.rows.length}</em>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}
      {detail?.lastReply !== undefined ? (
        <section className="lc-atlas-detail-section">
          <h3>{t('fleet.members.reply')}<time>{fmtTime(detail.lastReply.time)}</time></h3>
          <p className={'lc-atlas-reply' + (replyOpen ? ' lc-atlas-reply-open' : '')}>{detail.lastReply.text}</p>
          <button type="button" className="lc-inspector-btn" onClick={() => { setReplyOpen(value => !value) }}>{t(replyOpen ? 'fleet.collapse' : 'fleet.expand')}</button>
        </section>
      ) : null}
      {detail?.initialPrompt !== undefined ? (
        <section className="lc-atlas-detail-section">
          <h3>{t('fleet.prompt')}</h3>
          <p className={'lc-atlas-prompt' + (promptOpen ? ' lc-atlas-prompt-open' : '')}>{detail.initialPrompt}</p>
          <button type="button" className="lc-inspector-btn" onClick={() => { setPromptOpen(value => !value) }}>{t(promptOpen ? 'fleet.collapse' : 'fleet.expand')}</button>
        </section>
      ) : null}
      {props.detail === undefined ? <div className="lc-inspector-loading">{t('fleet.detailLoading')}</div> : null}
    </aside>
  )
}
