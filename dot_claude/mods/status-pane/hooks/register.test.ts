import { expect, mock, test } from 'claude-code/testing'
import {
  bar,
  C,
  cacheRow,
  CLEAN,
  count,
  directory,
  effortLevels,
  families,
  family,
  gitStatus,
  keepLimits,
  layout,
  LEVELS,
  limitLabel,
  modelName,
  pace,
  paint,
  pathTokens,
  savedEffort,
  span,
  startLabel,
  threshold,
  wrapPath,
} from './register'

// A palette of distinct colours, so each colour check names the right role.
const PALETTE = { fg: '#000002', blue: '#000003', cyan: '#000004', mag: '#000005', mid: '#000006', dim: '#000007', sub: '#000008', green: '#000009', yellow: '#00000a', red: '#00000b', claude: '#00000c' }
paint(PALETTE)

test('git counts: files modified, staged, untracked; commits ahead, behind', () => {
  const porcelain = [
    '# branch.oid 0123',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b src/a.c',
    '1 .M N... 100644 100644 100644 a b src/b.c',
    '1 MM N... 100644 100644 100644 a b src/c.c',
    '? notes.txt',
    '? todo.txt',
  ].join('\n')
  expect(gitStatus(porcelain)).toEqual({
    branch: 'main',
    git: { modified: 2, staged: 2, untracked: 2, ahead: 2, behind: 1 },
  })
})

test('clean detached repo counts nothing', () => {
  expect(gitStatus('# branch.head (detached)\n# branch.ab +0 -0')).toEqual({ branch: '', git: CLEAN })
})

test('a path shows ~ for $HOME and is otherwise kept whole', () => {
  expect(directory('/home/u/src/fw/drivers', '/home/u')).toBe('~/src/fw/drivers')
  expect(directory('/home/u', '/home/u')).toBe('~')
  expect(directory('/home/user2/x', '/home/u')).toBe('/home/user2/x')
  expect(directory('/usr/share', '')).toBe('/usr/share')
})

const lineText = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join('').trimEnd())

test('the path wraps at a slash onto a second row, then cuts folders after the repo', () => {
  const long = '~/work/clients/widget/widget-power-module/firmware/Middlewares/Third_Party/FreeRTOS/Source/portable'
  const t = pathTokens(long, '~/work/clients/widget/widget-power-module')
  expect(t.repo).toBe(4)
  expect(t.tokens[4]).toEqual({ text: 'widget-power-module/', color: C.blue, bold: true })
  expect(t.tokens[1]!.color).toBe(C.dim)
  expect(t.tokens[5]!.color).toBe(C.fg)
  // 54 cells hold the whole path in two rows.
  expect(lineText(wrapPath(t, 54))).toEqual(['~/work/clients/widget/widget-power-module/firmware/', 'Middlewares/Third_Party/FreeRTOS/Source/portable'])
  // 45 cells do not: the folders after the repo give way to …/.
  expect(lineText(wrapPath(t, 45))).toEqual(['~/work/clients/widget/widget-power-module/…/', 'Third_Party/FreeRTOS/Source/portable'])
  // One row: the folders above the repo go too; the repo and the last folders stay.
  expect(lineText(wrapPath(t, 45, 1))).toEqual(['~/…/widget/widget-power-module/…/portable'])
  expect(lineText(wrapPath(pathTokens('~/Temp/salam', null), 54))).toEqual(['~/Temp/salam'])
  expect(pathTokens('~/Temp/salam', null).tokens[2]).toEqual({ text: 'salam', color: C.blue, bold: true })
})

test('speed colours: green from 40 tok/s, yellow from 20, red below', () => {
  expect([pace(40), pace(39), pace(20), pace(19)]).toEqual([C.green, C.yellow, C.yellow, C.red])
})

test('context figures', () => {
  expect(count(45_300)).toBe('45k')
  expect(count(1_000_000)).toBe('1M')
})

test('model id becomes the display name, with or without a minor version', () => {
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelName('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('custom-model')).toBe('custom-model')
})

test('effort steps per model: five from 4.7 on, no xhigh on 4.6, three on Opus 4.5, none before', () => {
  for (const id of ['claude-opus-5-5[1m]', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-4-7']) expect(effortLevels(id)).toEqual(LEVELS)
  expect(effortLevels('claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max'])
  expect(effortLevels('claude-opus-4-5')).toEqual(['low', 'medium', 'high'])
  expect(effortLevels('claude-haiku-4-5')).toEqual([])
  expect(effortLevels('claude-sonnet-4-5-20250929')).toEqual([])
  expect(effortLevels('custom-model')).toEqual(LEVELS)
})

test('tok/s lands when the answer completes, and effort with the step', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.step', async function* (_, e) {
    await clock.sleep(2000)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 10,
        output_tokens: 300,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: 'claude-opus-5-5',
      },
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const written: unknown[] = []
  on('state.set', { plugin: 'status-pane', key: 'stats' }, (_, e, next) => {
    written.push(e.value)
    return next(e)
  })

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  const drained = (async () => {
    for await (const _ of step);
  })()
  await clock.advance(2000)
  await drained
  expect(written.at(-1)).toEqual({ effort: 'high' })

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 2000, isAborted: false, reason: 'answer' })
  expect(written.at(-1)).toEqual({ effort: 'high', tps: 150 })
})

test("a subagent's steps add up its tokens, and its own turn.complete stops it", async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'x1' }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
        model: 'claude-haiku-5-5',
      },
    }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const written: { id: string; tokens: number; status: string }[][] = []
  on('state.set', { plugin: 'status-pane', key: 'agents' }, (_, e, next) => {
    written.push(e.value as never)
    return next(e)
  })

  await $.agent.spawn({ prompt: 'p', description: 'review', subagentType: 'Explore', parentModel: 'claude-opus-5-5' } as never)
  for (const index of [0, 1]) {
    for await (const _ of $.turn.step({ turnId: 'a1', index, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'x1' } as never));
  }
  expect(written.at(-1)![0]).toMatchObject({ id: 'x1', tokens: 2300, status: 'running' })

  await $.turn.complete({ turnId: 'a1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'error', agentId: 'x1' })
  expect(written.at(-1)![0]).toMatchObject({ id: 'x1', status: 'failed' })
})

test('saved effort: per-model setting first, then the global one', () => {
  const settings = { effortLevel: 'medium', modelSettings: { 'claude-fable-5-1': { effortLevel: 'high' } } }
  expect(savedEffort(settings, 'claude-fable-5-1')).toBe('high')
  expect(savedEffort(settings, 'claude-opus-5-5[1m]')).toBe('medium')
  expect(savedEffort({}, 'claude-opus-5-5')).toBeUndefined()
})

test('the meter is a hairline: used part in the threshold colour, rest dark', () => {
  expect(bar(31, 20)).toEqual([
    { text: '━'.repeat(6), color: C.green },
    { text: '─'.repeat(14), color: C.sub },
  ])
  expect(bar(58, 10)[0]).toEqual({ text: '━'.repeat(6), color: C.yellow })
  expect(threshold(75)).toBe(C.red)
})

test('spans read at minute resolution', () => {
  expect(span(47 * 60000 + 59000)).toBe('47m')
  expect(span(83 * 60000)).toBe('1h 23m')
  expect(span((3 * 24 + 4) * 3_600_000)).toBe('3d 4h')
})

test('limit labels, including a per-model weekly window', () => {
  expect(limitLabel('five_hour')).toBe('5-hour')
  expect(limitLabel('seven_day')).toBe('Weekly')
  expect(limitLabel('spend_limit')).toBe('Spend')
  expect(limitLabel('seven_day_fable')).toBe('Fable weekly')
})

const text = (r: { text: string }[]) => r.map(s => s.text).join('')

test('the cache sentence: warm, cooling, cold, and a placeholder before the first request', () => {
  expect(text(cacheRow(0, '1h', 13 * 60000, 116_000))).toBe('● warm, 47m left of 1h')
  const cooling = cacheRow(0, '1h', 56 * 60000, 116_000)
  expect(text(cooling)).toBe('● cooling, 4m left of 1h')
  expect(cooling[2]).toEqual({ text: 'cooling', color: C.yellow, bold: true })
  expect(text(cacheRow(0, '5m', 6 * 60000, 116_000))).toBe('○ cold, next request rewrites 116k tokens')
  expect(text(cacheRow(null, '1h', 0, 0))).toBe('○ no request yet')
})

test('the start: clock time today, yesterday, then month and day', () => {
  expect(startLabel('2026-10-24 14:05 Oct 24', '2026-10-24', '2026-10-23')).toBe('14:05')
  expect(startLabel('2026-10-23 23:40 Oct 23', '2026-10-24', '2026-10-23')).toBe('yesterday 23:40')
  expect(startLabel('2026-10-15 10:40 Oct 15', '2026-10-24', '2026-10-23')).toBe('Oct 15 10:40')
  expect(startLabel('', '', '')).toBe('')
})

const snap = {
  dir: '~/src/widget-power-module/firmware/Middlewares/Third_Party/FreeRTOS/Source/portable',
  root: '~/src/widget-power-module' as string | null,
  inRepo: true,
  branch: 'main',
  git: { modified: 3, staged: 0, untracked: 2, ahead: 1, behind: 0 },
  modelId: 'claude-opus-5-5[1m]',
  effort: 'high' as string | undefined,
  tokens: 116_000,
  window: 1_000_000,
  percent: 12,
  tps: 84 as number | undefined,
  limits: [
    { kind: 'five_hour', percentUsed: 41, resetsAt: '1970-01-01T05:00:00Z' },
    { kind: 'seven_day_fable', percentUsed: 23 },
  ] as { kind: string; percentUsed: number; resetsAt?: string }[],
  cost: 4.12,
  startedAt: 0,
  since: '14:02',
  tick: 0,
}
const agent = (id: string, status: string, model = 'claude-haiku-5-5') => ({
  id,
  name: id,
  model,
  tokens: 41_000,
  status,
  startedAt: 0,
  endedAt: 40_000,
})
const agents = [agent('a', 'running'), agent('b', 'completed', 'claude-sonnet-5-5'), agent('c', 'failed')]
const pane = (over: Partial<typeof snap> = {}, list = agents, at: number | null = 0, width = 60) =>
  layout({ snap: { ...snap, ...over }, agents: list, cache: at, ttl: '1h', now: 13 * 60000, width })

test('families: Opus, Sonnet, Haiku always, in that order; a new family follows with no code', () => {
  const list = [...agents, agent('d', 'completed', 'claude-fable-5-1'), agent('e', 'running', 'claude-fable-5-1'), agent('f', 'killed', 'claude-fable-5-1')]
  const f = families(list, 60_000)
  expect(f.map(x => x.name)).toEqual(['Opus', 'Sonnet', 'Haiku', 'Fable'])
  expect(f[0]).toEqual({ name: 'Opus', used: 0, running: 0, failed: 0, tokens: 0, ms: 0 })
  // A running agent counts its time up to now; killed counts as failed.
  expect(f[3]).toEqual({ name: 'Fable', used: 3, running: 1, failed: 1, tokens: 123_000, ms: 120_000 })
  expect(families([], 0).map(x => x.name)).toEqual(['Opus', 'Sonnet', 'Haiku'])
  expect(family('claude-opus-5-5[1m]')).toBe('Opus')
})

test('every pane row is exactly the pane width', () => {
  const many = { limits: ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'spend_limit'].map(kind => ({ kind, percentUsed: 60, resetsAt: '1970-01-02T00:00:00Z' })) }
  for (const w of [60, 48, 40]) {
    for (const p of [pane({}, agents, 0, w), pane({}, [], null, w), pane({ inRepo: false, branch: '', git: CLEAN, limits: [] }, [], null, w), pane(many, agents, 0, w)]) {
      for (const r of [...p.head, ...p.foot, p.filler]) expect(text(r).length).toBe(w)
    }
  }
})

test('rounded boxes: Model, Directory, Git, Session, Subagents, limits on the bottom', () => {
  const p = pane()
  const rows = p.head.map(text)
  expect(rows[0]).toMatch(/^ ╭─ Model ─+╮ $/)
  expect(rows[1]).toMatch(/^ │ Opus 5\.5 ▪▪▪·· {2}high +│ $/)
  expect(p.head[1]!.find(s => s.text === 'Opus 5.5')!.color).toBe(C.claude)
  expect(p.head[1]!.find(s => s.text === '▪▪▪')!.color).toBe(C.claude)
  // The whole path from ~ in two rows, the repo's own folder blue.
  expect(rows[3]).toMatch(/^ ╭─ Directory ─+╮ $/)
  expect(rows[4]).toMatch(/^ │ ~\/src\/widget-power-module\/firmware\/Middlewares\/ +│ $/)
  expect(rows[5]).toMatch(/^ │ Third_Party\/FreeRTOS\/Source\/portable +│ $/)
  expect(p.head[4]!.find(s => s.text === 'widget-power-module/')!.color).toBe(C.blue)
  expect(rows[7]).toMatch(/^ ╭─ Git ─+╮ $/)
  expect(rows[8]).toMatch(/^ │ Branch +main +│ $/)
  expect(p.head[8]!.find(s => s.text === 'main')!.color).toBe(C.mag)
  expect(rows[9]).toMatch(/^ │ Changes +3 modified {2}0 staged {2}2 untracked +│ $/)
  expect(p.head[9]!.find(s => s.text === '3 modified')!.color).toBe(C.yellow)
  expect(p.head[9]!.find(s => s.text === '0 staged')!.color).toBe(C.sub)
  expect(p.head[9]!.find(s => s.text === '2 untracked')!.color).toBe(C.cyan)
  expect(rows[10]).toMatch(/^ │ Sync +⇡1 ahead {2}⇣0 behind +│ $/)
  expect(p.head[10]!.find(s => s.text === '⇡1 ahead')!.color).toBe(C.blue)
  expect(rows[12]).toMatch(/^ ╭─ Session ─+╮ $/)
  expect(rows[13]).toMatch(/^ │ Time +13m {2}since 14:02 +│ $/)
  expect(rows[14]).toMatch(/^ │ Cache +● warm, 47m left of 1h +│ $/)
  expect(rows[15]).toMatch(/^ │ Context +12% at 84 tok\/s +│ $/)
  expect(p.head[15]!.find(s => s.text === '84')!.color).toBe(C.green)
  // The hairline ends in the token count: 12% of the 42 cells left is 5.
  expect(rows[16]).toBe(' │ ' + '━'.repeat(5) + '─'.repeat(37) + '  116k of 1M │ ')
  expect(rows[18]).toMatch(/^ ╭─ Subagents ─+╮ $/)
  expect(rows[19]!.split(/ +/).slice(2, 6)).toEqual(['Opus', 'Sonnet', 'Haiku', 'Total'])
  expect(rows[20]).toMatch(/^ │ Used +– +1 +2 +3 +│ $/)
  expect(rows[21]).toMatch(/^ │ Running +· +· +● 1 +● 1 +│ $/)
  expect(rows[22]).toMatch(/^ │ Failed +· +· +✗ 1 +✗ 1 +│ $/)
  expect(rows[23]).toMatch(/^ │ Tokens +– +41k +82k +123k +│ $/)
  expect(rows[24]).toMatch(/^ │ Time +– +40s +1m +2m +│ $/)
  expect(rows).toHaveLength(26)
  const foot = p.foot.map(text)
  expect(foot[0]).toMatch(/^ ╭─ Usage limits ─+╮ $/)
  // One row each: 41% of the 24-cell hairline is 10 cells; no reset time shows ↻ –.
  // The label column fits "Fable weekly" plus one space, so the hairline gets 24 cells.
  expect(foot[1]).toBe(' │ 5-hour        41%  ' + '━'.repeat(10) + '─'.repeat(14) + '   ↻ 4h 47m │ ')
  expect(foot[2]).toBe(' │ Fable weekly  23%  ' + '━'.repeat(6) + '─'.repeat(18) + '        ↻ – │ ')
  expect(p.foot[1]!.find(s => s.text === '━'.repeat(10))!.color).toBe(C.green)
  // Under a rule, the spend: $4.12 over 13 minutes is $19.02 per hour.
  expect(foot[3]).toBe(' │ ' + '─'.repeat(54) + ' │ ')
  expect(foot[4]).toMatch(/^ │ Spent {8}\$4\.12 +\$19\.02 per hour │ $/)
  expect(foot).toHaveLength(6)
})

test('before any agent or request: no speed, a cache placeholder, dashes, a note for limits', () => {
  const p = pane({ tps: undefined, effort: undefined, limits: [] }, [], null)
  const rows = p.head.map(text)
  expect(rows[1]).toMatch(/^ │ Opus 5\.5 ····· {2}default effort +│ $/)
  expect(rows.find(r => r.includes('Context'))).toMatch(/^ │ Context +12% at - tok\/s +│ $/)
  expect(text(pane({ cost: undefined }).foot.at(-2)!)).toMatch(/^ │ Spent {8}- +│ $/)
  expect(rows.find(r => r.includes('Cache'))).toMatch(/^ │ Cache +○ no request yet +│ $/)
  expect(rows.find(r => r.includes('Used'))!.trim().split(/ +/)).toEqual(['│', 'Used', '–', '–', '–', '–', '│'])
  expect(text(p.foot[1]!)).toMatch(/Limits appear after the first answer\./)
  expect(text(p.foot[3]!)).toMatch(/^ │ Spent \$4\.12 +\$19\.02 per hour │ $/)
})

test('outside git the Git box says so; a detached HEAD shows in the Branch row', () => {
  const outside = pane({ dir: '~/Temp/salam', root: null, inRepo: false, branch: '', git: CLEAN }).head.map(text)
  expect(outside[4]).toMatch(/^ │ ~\/Temp\/salam +│ $/)
  expect(outside[5]).toMatch(/^ ╰─+╯ $/)
  expect(outside[6]).toMatch(/^ ╭─ Git ─+╮ $/)
  expect(outside[7]).toMatch(/^ │ not a git repo +│ $/)
  expect(outside[8]).toMatch(/^ ╰─+╯ $/)
  const detached = pane({ dir: '~/work/salam', root: '~/work/salam', branch: '', git: CLEAN }).head.map(text)
  expect(detached[4]).toMatch(/^ │ ~\/work\/salam +│ $/)
  expect(detached[7]).toMatch(/^ │ Branch +detached HEAD +│ $/)
  expect(detached[8]).toMatch(/0 modified/)
})

test('a model without effort says so; an older model has fewer steps', () => {
  expect(pane({ modelId: 'claude-haiku-4-5', effort: undefined }).head.map(text)[1]).toMatch(/^ │ Haiku 4\.5 {2}no effort setting/)
  expect(pane({ modelId: 'claude-sonnet-4-6', effort: 'max' }).head.map(text)[1]).toMatch(/^ │ Sonnet 4\.6 ▪▪▪▪ {2}max /)
})

test('one row per limit, the hairline in the threshold colour', () => {
  const kinds = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'spend_limit']
  const p = pane({ limits: kinds.map((kind, i) => ({ kind, percentUsed: [80, 10, 60, 10, 10][i]!, resetsAt: '1970-01-01T01:00:00Z' })) })
  const foot = p.foot.map(text)
  expect(foot).toHaveLength(9)
  expect(foot.slice(1, 6).map(r => r.slice(3, 17).trim())).toEqual(['5-hour', 'Weekly', 'Opus weekly', 'Sonnet weekly', 'Spend'])
  expect(p.foot[1]!.find(s => s.text.startsWith('━'))!.color).toBe(C.red)
  expect(p.foot[3]!.find(s => s.text.startsWith('━'))!.color).toBe(C.yellow)
})

test('a window the engine stops reporting stays as an unknown row', () => {
  const first = keepLimits([], [{ kind: 'five_hour', percentUsed: 41, resetsAt: '1970-01-01T05:00:00Z' }, { kind: 'seven_day', percentUsed: 12 }])
  expect(first.seen).toEqual(['five_hour', 'seven_day'])
  const idle = keepLimits(first.seen, [{ kind: 'seven_day', percentUsed: 12 }])
  expect(idle.limits).toEqual([{ kind: 'five_hour' }, { kind: 'seven_day', percentUsed: 12 }])
  // A later response brings the reading back in its old place.
  expect(keepLimits(idle.seen, [{ kind: 'seven_day', percentUsed: 13 }, { kind: 'five_hour', percentUsed: 2 }]).limits.map(l => l.kind)).toEqual(['five_hour', 'seven_day'])
  const foot = pane({ limits: idle.limits as typeof snap.limits }).foot.map(text)
  expect(foot[1]).toMatch(/^ │ 5-hour +\? +─+ +↻ \? │ $/)
  expect(foot[2]).toMatch(/^ │ Weekly +12% /)
})

test('/status-pane opens the pane with a terminal attached, and not without one', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  let surfaces: string[] = ['desktop']
  on('session.surfaces', () => ({ value: surfaces }))

  const desktop = await $.command.run({ command: 'status-pane', args: '' })
  expect(desktop.text).toBe('The status pane is drawn in a terminal only.')
  expect(opened).toEqual([])

  surfaces = ['terminal', 'mobile']
  const terminal = await $.command.run({ command: 'status-pane', args: '' })
  expect(terminal.text).toBe('Status pane opened.')
  expect(opened).toEqual(['status-pane'])
})


test('paint fills the palette from options, an unset field empty', () => {
  paint({ red: '#ff0000' })
  expect(C.red).toBe('#ff0000')
  expect(C.fg).toBe('')
  paint(PALETTE)
})
