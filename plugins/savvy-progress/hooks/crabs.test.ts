import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { crabRows, termCostume } from './register'

const PLUGIN = 'savvy-progress'
const pane = (bodyColumns: number) =>
  ({ title: '', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }) as const

const worker = async ($: Engine, on: On, subagentType: string) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.agent.spawn({ tool_use_id: 't1', prompt: 'p', description: 'Crab work', subagentType, provider: 'engine', parentModel: 'claude-sonnet-5-5', background: true, fork: false } as never)
}

const halfBlocks = async ($: Engine, cols: number) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'savvy-agents', props: pane(cols) })
  const cells = await ui.findAll({ type: 'Text', text: /^[▀▄]+$/ })
  const title = await ui.find({ type: 'Text', text: /^Crab work$/ })
  await ui.unmount()
  return { cells: cells.length, hasTitle: title !== undefined }
}

test('terminal: a running agent gets a pixel crab beside its row', async ($, on) => {
  await worker($, on, 'general-purpose')
  const drawn = await halfBlocks($, 80)
  expect(drawn.hasTitle).toBe(true)
  expect(drawn.cells).toBeGreaterThan(10)
})

test('terminal: a narrow pane keeps the text rows alone', async ($, on) => {
  await worker($, on, 'general-purpose')
  expect(await halfBlocks($, 40)).toEqual({ cells: 0, hasTitle: true })
})

test('every costume draws 3 rows of 8 cells, and walking moves the legs', async () => {
  for (const costume of ['other', 'fable', 'heavy', 'careful', 'medium', 'light', 'explore']) {
    const rows = crabRows(costume, 1, false, false)
    expect(rows.length).toBe(3)
    for (const runs of rows) expect(runs.map(([t]) => t).join('').length).toBe(8)
    expect(JSON.stringify(crabRows(costume, 2, false, false))).not.toBe(JSON.stringify(rows))
  }
})

test('agents that are not savvy workers still get different costumes', async () => {
  expect(termCostume('Explore', 'claude-haiku-5-5')).toBe('explore')
  expect(termCostume('general-purpose', 'claude-haiku-5-5')).toBe('light')
  expect(termCostume('general-purpose', 'claude-sonnet-5-5')).toBe('medium')
  expect(termCostume('general-purpose', 'claude-opus-5-5')).toBe('heavy')
  expect(termCostume('savvy-careful', 'claude-opus-5-5')).toBe('careful')
})
