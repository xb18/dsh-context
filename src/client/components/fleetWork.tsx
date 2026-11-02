import { useMemo, type CSSProperties, type ReactElement } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentForest, AgentNode } from '../agentTree'
import type { CommsAgent } from '../commsModel'
import type { FleetDetailState } from '../fleetModel'
import { familyOthersOf, memberIdByName, type FleetTeam, type FleetTeamTask } from '../fleetTeam'
import type { ViewKit } from '../viewkit'
import { AgentAvatar } from './commsAgent'

export interface WorkItem {
  id: string
  subject: string
  description: string
  status: FleetTeamTask['status'] | 'idle'
  turnCompleted: boolean
  ownerId?: string
  ownerName: string
  task: FleetTeamTask | null
  node: AgentNode | null
}

export function workItemsOf(team: FleetTeam | null, forest: AgentForest | null): WorkItem[] {
  const tasks = (team?.tasks ?? []).map(task => ({
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    turnCompleted: task.status === 'completed',
    ownerId: memberIdByName(team, task.ownerName),
    ownerName: task.ownerName ?? '',
    task,
    node: null,
  }))
  const delegations = familyOthersOf(forest, team).map(node => ({
    id: `agent:${node.id}`,
    subject: node.label,
    description: '',
    status: node.running ? 'in_progress' as const : 'idle' as const,
    turnCompleted: node.completed,
    ownerId: node.id,
    ownerName: node.label,
    task: null,
    node,
  }))
  return [...tasks, ...delegations]
}

export interface FleetWorkProps {
  team: FleetTeam | null
  forest: AgentForest | null
  details: FleetDetailState
  selectedId: string | null
  focusTaskId: string | null
  agentOf: (id: string) => CommsAgent
  onSelect: (id: string) => void
  onFocusTask: (id: string | null) => void
  t: ViewKit['t']
}

const STATUS: readonly WorkItem['status'][] = ['in_progress', 'pending', 'idle', 'completed']

export function FleetWork(props: FleetWorkProps): ReactElement {
  const { t } = props
  const items = useMemo(() => workItemsOf(props.team, props.forest), [props.team, props.forest])
  const scoped = props.selectedId === null ? items : items.filter(item => item.ownerId === props.selectedId)
  const tasks = items.filter(item => item.task !== null)
  const done = tasks.filter(item => item.status === 'completed').length
  return (
    <section className="lc-card lc-atlas-work" aria-label={t('fleet.atlas.work')}>
      <div className="lc-atlas-section-head">
        <div>
          <div className="lc-card-title-text">{t('fleet.atlas.work')}</div>
          <p>{t('fleet.atlas.workSub')}</p>
        </div>
        <div className="lc-atlas-work-progress">
          <span>{tasks.length === 0 ? '—' : `${done}/${tasks.length}`}</span>
          <i><b style={{ width: `${tasks.length === 0 ? 0 : Math.round(done / tasks.length * 100)}%` }} /></i>
        </div>
      </div>
      {props.team?.failure !== undefined ? <div className="lc-atlas-error">{t('fleet.team.failureShort')} · {props.team.failure}</div> : null}
      {scoped.length === 0 ? <div className="lc-empty">{t(items.length === 0 ? 'fleet.tasks.noTeam' : 'fleet.tasks.noMatch')}</div> : (
        <div className="lc-atlas-work-columns">
          {STATUS.map((status) => {
            const rows = scoped.filter(item => item.status === status)
            if (rows.length === 0) return null
            return (
              <div className="lc-atlas-work-column" key={status} data-status={status}>
                <h3><StateDot state={status === 'completed' ? 'done' : status === 'in_progress' ? 'ongoing' : 'idle'} size={8} />{t(status === 'idle' ? 'fleet.filter.idle' : `fleet.taskCol.${status}`)}<span>{rows.length}</span></h3>
                <div className="lc-atlas-work-list">
                  {rows.map((item) => {
                    const focused = props.focusTaskId === item.id
                    const ownerId = item.ownerId
                    const agent = ownerId !== undefined ? props.agentOf(ownerId) : null
                    const detail = item.node !== null ? props.details.landed.get(item.node.id)?.detail : null
                    const description = item.description !== '' ? item.description : detail?.initialPrompt ?? ''
                    const hue = agent?.hue ?? 'var(--dsw-alias-border-l2)'
                    return (
                      <article
                        key={item.id}
                        className={'lc-atlas-work-item' + (focused ? ' lc-atlas-work-item-focus' : '')}
                        style={{ '--lc-member-hue': hue } as CSSProperties}
                        data-task={item.id}
                      >
                        <button type="button" className="lc-atlas-work-open" aria-expanded={focused} onClick={() => { props.onFocusTask(focused ? null : item.id) }}>
                          <span>{item.subject}</span>
                          <em>{t(item.status === 'idle' ? 'fleet.filter.idle' : `fleet.task.${item.status}`)}</em>
                        </button>
                        <div className="lc-atlas-work-meta">
                          {agent !== null && ownerId !== undefined ? (
                            <button type="button" className="lc-atlas-owner" onClick={() => { props.onSelect(ownerId) }}>
                              <AgentAvatar agent={agent} size="sm" t={t} />{agent.name}
                            </button>
                          ) : <span>{t('fleet.taskUnowned')}</span>}
                          {item.task !== null && !item.task.ready && item.task.status !== 'completed' ? <span>{t('fleet.taskBlocked')}</span> : null}
                          {item.task === null && item.turnCompleted ? <span>{t('fleet.atlas.turnDone')}</span> : null}
                          {item.task === null && item.node?.identity !== null && item.node?.identity !== undefined ? <span>{t(item.node.identity.mode === 'one-shot' ? 'agents.oneshot' : 'agents.continuable')}</span> : null}
                        </div>
                        {focused ? (
                          <div className="lc-atlas-work-detail">
                            {description !== '' ? <p>{description}</p> : null}
                            {item.task !== null && item.task.blockedBy.length > 0 ? (
                              <div className="lc-atlas-deps"><span>{t('fleet.tasks.dependsOn')}</span>{item.task.blockedBy.map(id => (
                                <button type="button" key={id} data-task-dep={id} onClick={() => { props.onFocusTask(id) }}>{id}</button>
                              ))}</div>
                            ) : null}
                            {item.task !== null && item.task.writeScopes.length > 0 ? <p>{t('fleet.taskScopes')} {item.task.writeScopes.join(' · ')}</p> : null}
                            {item.task?.warnings.map(warning => <p className="lc-atlas-warning" key={warning}>{warning}</p>)}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
