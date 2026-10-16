import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { groupSessions, projectOf } from './register'
import type { AgentRun, SharedSession } from '../types'

const PLUGIN = 'savvy-progress'
const DIR = '/home/me/.claude/savvy-progress/sessions'
const pane = { title: '', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const run = (id: string, description: string, startedAt = 0): AgentRun => ({
  id,
  agentId: id,
  type: 'general-purpose',
  description,
  model: 'claude-sonnet-5-5',
  status: 'running',
  startedAt,
  contextTokens: 0,
  contextMax: 1_000_000,
  tokens: 1000,
  costUsd: 0.01,
  steps: 1,
  round: 1,
})

// A file system in memory, as the engine's own would answer $.fs under DIR.
const fakeFs = (on: On, now: () => number) => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  on('fs.write', (_$, e) => {
    files.set(e.path, { text: e.text, mtimeMs: now() })
    return { value: undefined }
  })
  on('fs.list', (_$, e) => ({
    value: [...files.entries()]
      .filter(([p]) => p.startsWith(e.path + '/'))
      .map(([p, f]) => ({ name: p.slice(e.path.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })),
  }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path)?.text ?? '' }))
  return files
}

const other = (sessionId: string, root: string, agents: AgentRun[], updatedAt: number): string =>
  JSON.stringify({ sessionId, root, project: projectOf(root), updatedAt, agents } satisfies SharedSession)

test('all agents: every session with running agents, grouped by project', async ($, on) => {
  const clock = mock.clock(on, { now: 100_000 })
  mock.env(on, { HOME: '/home/me' })
  const files = fakeFs(on, clock.now)
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/zeta' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Local crab', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-sonnet-5-5', background: true, fork: false } as never)

  // Two more sessions in another project, one gone quiet long ago.
  files.set(`${DIR}/s2.json`, { text: other('s2', '/work/alpha', [run('b1', 'Alpha crab', 99_000)], 99_000), mtimeMs: 99_000 })
  files.set(`${DIR}/s3.json`, { text: other('s3', '/work/alpha', [run('c1', 'Stale crab')], 1_000), mtimeMs: 1_000 })

  const opened = await $.command.run({ command: 'agents-all', args: '' } as never)
  expect(opened).toMatchObject({ text: 'All-agents panel opened.' })
  // This session published its own running agent.
  expect(JSON.parse(files.get(`${DIR}/mine.json`)!.text).agents[0].description).toBe('Local crab')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-global', props: pane })
  const projects = await ui.findAll({ type: 'Text', text: /^(alpha|zeta)$/ })
  expect(projects.map(t => JSON.stringify(t).match(/alpha|zeta/)?.[0])).toEqual(['alpha', 'zeta'])
  expect(await ui.find({ type: 'Text', text: /^Alpha crab$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Local crab$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Stale crab$/ })).toBeUndefined()
  await ui.unmount()
})

test('all agents: a session that ends stops showing at once', async ($, on) => {
  const clock = mock.clock(on, { now: 100_000 })
  mock.env(on, { HOME: '/home/me' })
  const files = fakeFs(on, clock.now)
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/zeta' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.end', () => ({ sessionId: 'mine' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a2' }))
  await $.agent.spawn({ tool_use_id: 't2', prompt: 'p', description: 'Local crab', subagentType: 'general-purpose', provider: 'engine', parentModel: 'claude-sonnet-5-5', background: true, fork: false } as never)
  await $.command.run({ command: 'agents-all', args: '' } as never)
  expect(JSON.parse(files.get(`${DIR}/mine.json`)!.text).agents.length).toBe(1)

  await $.session.end({ reason: 'other', sessionId: 'mine' } as never)
  expect(JSON.parse(files.get(`${DIR}/mine.json`)!.text).agents.length).toBe(0)
})

test('grouping drops idle and stale sessions and sorts projects by name', () => {
  const list: SharedSession[] = [
    { sessionId: 'b', root: '/x/web', project: 'web', updatedAt: 50_000, agents: [run('1', 'w')] },
    { sessionId: 'a', root: '/x/api', project: 'api', updatedAt: 50_000, agents: [run('2', 'a')] },
    { sessionId: 'c', root: '/x/api', project: 'api', updatedAt: 50_000, agents: [] },
    { sessionId: 'd', root: '/x/old', project: 'old', updatedAt: 0, agents: [run('3', 'o')] },
  ]
  expect(groupSessions(list, 60_000).map(([root, s]) => [root, s.length])).toEqual([
    ['/x/api', 1],
    ['/x/web', 1],
  ])
})
