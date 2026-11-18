import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, PluginOptions, Register } from 'claude-code'

import type { Agent, GitFlags, Segment, Snapshot } from '../types'

// The figures of the `claude-code` starship profile (dir, git, model, effort,
// context, tok/s), plus limits, cache, session time, cost and subagents, in a
// pane docked on the right (the rounded-boxes layout of the round-two mockups).

const stats = atom({ plugin: 'status-pane', key: 'stats' } as const, {})
const snap = atom({ plugin: 'status-pane', key: 'snap' } as const, null)
const agents = atom({ plugin: 'status-pane', key: 'agents' } as const, [])
const cache = atom({ plugin: 'status-pane', key: 'cache' } as const, null)
const ttl = atom({ plugin: 'status-pane', key: 'ttl' } as const, null)

const PANE = 'status-pane'

let home = ''
// The main loop's turn in flight; its tok/s is published when it completes.
let turn = { id: '', out: 0, ms: 0 }
// `date` formats the session start in local time; rerun when it moves (/clear) and
// each minute, so the label turns to "yesterday" and then a date as midnights pass.
let since = { at: -1, minute: -1, text: '' }
// Every limit window the engine has reported this process, in first-seen order.
let seenLimits: string[] = []
// The saved effort the last refresh read; null before the first refresh.
let lastSaved: string | undefined | null = null

export const count = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

// claude-<family>-<major>[-<minor>], where a minor is one or two digits, so a
// date suffix (-20250929) is never read as one.
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/

// $.session.model() gives the id; starship shows the display name.
export function modelName(id: string) {
  const m = MODEL_ID.exec(id)
  if (!m) return id
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)
  return m[3] === undefined ? `${family} ${m[2]}` : `${family} ${m[2]}.${m[3]}`
}

// The effort levels a model accepts, from the claude-api model table: every
// model from 4.7 on takes all five; the 4.6 models lack xhigh; Opus 4.5 takes
// the first three; Sonnet 4.5, Haiku 4.5 and older take none. An id that is not
// a Claude one gets all five, so a reported level always has a step.
export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export function effortLevels(id: string): string[] {
  const m = MODEL_ID.exec(id)
  if (!m) return LEVELS
  const version = Number(m[2]) + Number(m[3] ?? 0) / 10
  if (version >= 4.7) return LEVELS
  if (version === 4.6) return ['low', 'medium', 'high', 'max']
  if (version === 4.5 && m[1] === 'opus') return ['low', 'medium', 'high']
  return []
}

// A path as the pane shows it: ~ for $HOME, otherwise as it is. The whole path is
// kept; the pane wraps it to the room it has (wrapPath).
export function directory(path: string, home: string) {
  if (home && (path === home || path.startsWith(home + '/'))) return '~' + path.slice(home.length)
  return path
}

export const CLEAN: GitFlags = { modified: 0, staged: 0, untracked: 0, ahead: 0, behind: 0 }

// git_branch + git_status from `git status --porcelain=v2 --branch`, as file counts.
// A file with both a staged and an unstaged change counts in both.
export function gitStatus(porcelain: string) {
  let head = ''
  const git = { ...CLEAN }
  for (const row of porcelain.split('\n')) {
    if (row.startsWith('# branch.head ')) head = row.slice(14)
    else if (row.startsWith('# branch.ab ')) {
      const [a, b] = row.slice(12).split(' ')
      git.ahead = Number(a)
      git.behind = -Number(b)
    } else if (row[0] === '1' || row[0] === '2' || row[0] === 'u') {
      if (row[2] !== '.') git.staged++
      if (row[3] !== '.') git.modified++
    } else if (row[0] === '?') git.untracked++
  }
  return { branch: head === '(detached)' ? '' : head, git }
}

// The engine reports effort with each request; before the first one, show the
// level the settings hold for this model, as /model would start it.
export function savedEffort(settings: Readonly<Record<string, unknown>>, model: string) {
  const perModel = settings.modelSettings as Record<string, { effortLevel?: string }> | undefined
  const level = perModel?.[model.replace(/\[.*\]$/, '')]?.effortLevel ?? settings.effortLevel
  return typeof level === 'string' ? level : undefined
}

// ---- pane: pure layout ------------------------------------------------------

// The palette, filled from the userConfig fields in plugin.json. Each default is a /theme
// key, so the pane follows the person's theme; a field may hold a hex colour instead. The
// pane's background is the theme's composerSidebarBackground. The Claude accent marks the
// model; green, yellow and red mark state; blue, cyan and violet colour the directory and
// git boxes alone.
const COLORS = ['fg', 'blue', 'cyan', 'mag', 'mid', 'dim', 'sub', 'green', 'yellow', 'red', 'claude'] as const
export const C = Object.fromEntries(COLORS.map(k => [k, ''])) as Record<(typeof COLORS)[number], string>

// Fills C from the plugin's options. register runs it on each load, and a /config change reloads.
export function paint(options: PluginOptions) {
  for (const k of COLORS) C[k] = String(options[k] ?? '')
}

const STOPPED = ['completed', 'failed', 'killed']

// starship's claude_context.display steps: success, then warning from 50, error from 75.
export const threshold = (percent: number) => (percent >= 75 ? C.red : percent >= 50 ? C.yellow : C.green)

// A hairline meter: ━ for the used part in the threshold colour, ─ for the rest.
export function bar(percent: number, width: number): Segment[] {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return [
    { text: '━'.repeat(filled), color: threshold(percent) },
    { text: '─'.repeat(width - filled), color: C.sub },
  ]
}

// Minutes resolution: 47m, 1h 23m, 3d 4h.
export function span(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d) return `${d}d ${h}h`
  return h ? `${h}h ${m % 60}m` : `${m % 60}m`
}

// The session start as the Time row names it: the clock time today, "yesterday"
// and the time the day before, the month and day before that. `start` is
// `date +'%F %H:%M %b %-d'`; `today` and `yesterday` are `%F` dates.
export function startLabel(start: string, today: string, yesterday: string) {
  const [day, time, month, date] = start.split(' ')
  if (time === undefined) return ''
  if (day === today) return time
  if (day === yesterday) return `yesterday ${time}`
  return `${month} ${date} ${time}`
}

// Agent time in the matrix: seconds under a minute, then minutes, so a column
// of 8 cells never holds two numbers.
const agentTime = (ms: number) => (ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))}s` : span(ms))

// The engine names five_hour, seven_day and spend_limit; a per-model weekly
// window (seven_day_<model>) reads as "<Model> weekly".
export function limitLabel(kind: string) {
  if (kind === 'five_hour') return '5-hour'
  if (kind === 'seven_day') return 'Weekly'
  if (kind === 'spend_limit') return 'Spend'
  const m = /^seven_day_(\w+)$/.exec(kind)
  if (m) return `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} weekly`
  const words = kind.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The engine drops a window it no longer has a reading for (the 5-hour one
// after its reset passes with no answer since). A window seen before keeps its
// row with no percent, so the pane shows it as unknown instead of hiding it.
export function keepLimits(seen: string[], current: Snapshot['limits']) {
  const kinds = [...seen, ...current.map(l => l.kind).filter(k => !seen.includes(k))]
  return { seen: kinds, limits: kinds.map(kind => current.find(l => l.kind === kind) ?? { kind }) }
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s)
const width = (segs: Segment[]) => segs.reduce((n, s) => n + s.text.length, 0)

// Cuts or pads a row to exactly `w` cells.
export function fit(segs: Segment[], w: number): Segment[] {
  const out: Segment[] = []
  let left = w
  for (const s of segs) {
    if (left <= 0) break
    const text = s.text.slice(0, left)
    out.push({ ...s, text })
    left -= text.length
  }
  if (left > 0) out.push({ text: ' '.repeat(left) })
  return out
}

// The left part flush left, the right part flush right, in `w` cells.
const lr = (left: Segment[], right: Segment[], w: number): Segment[] => [...fit(left, w - width(right)), ...right]

// The path in folders that end at a slash: the folders above the repo dim, the
// repo's own folder blue and bold, the folders inside it normal. Outside git the
// current folder takes the repo's place. Returns the tokens and the repo's index.
export function pathTokens(dir: string, root: string | null): { tokens: Segment[]; repo: number } {
  const parts = dir.split('/')
  const repo = root ? Math.min(parts.length, root.split('/').length) - 1 : parts.length - 1
  const tokens = parts.map((p, i) => ({ text: p + (i < parts.length - 1 ? '/' : ''), color: i < repo ? C.dim : i === repo ? C.blue : C.fg, bold: i === repo }))
  return { tokens, repo }
}

// Wraps the path at slashes into lines of `w` cells. While that takes more than
// `max` lines, the folders just after the repo give way to one …/, then the folders
// between the first one and the repo; the repo and the last two folders always stay.
export function wrapPath({ tokens, repo }: { tokens: Segment[]; repo: number }, w: number, max = 2): Segment[][] {
  const wrap = (list: Segment[]) => {
    const lines: Segment[][] = [[]]
    for (const t of list) {
      const cur = lines[lines.length - 1]!
      if (cur.length && width(cur) + t.text.length > w) lines.push([t])
      else cur.push(t)
    }
    return lines
  }
  const gap: Segment = { text: '…/', color: C.dim }
  let tk = tokens
  let ri = repo
  let lines = wrap(tk)
  while (lines.length > max && tk.length > ri + 3) {
    const drop = tk[ri + 1] === gap ? ri + 2 : ri + 1
    tk = [...tk.slice(0, ri + 1), gap, ...tk.slice(drop + 1)]
    lines = wrap(tk)
  }
  while (lines.length > max) {
    if (ri > 1 && tk[1] !== gap) tk = [tk[0]!, gap, ...tk.slice(2)]
    else if (ri > 2) (tk = [...tk.slice(0, 2), ...tk.slice(3)]), ri--
    else break
    lines = wrap(tk)
  }
  return lines.slice(0, max).map(l => fit(l, w))
}

// Hot while the last main-thread response is younger than the TTL; each request
// that reads the cache starts the TTL over. The last tenth is "cooling"; once
// cold, the sentence names what the next request rewrites. Before the first
// request the row stays and says so, so the box keeps its shape.
export function cacheRow(at: number | null, ttl: '5m' | '1h', now: number, tokens: number): Segment[] {
  if (at === null) return [{ text: '○', color: C.sub }, { text: ' ' }, { text: 'no request yet', color: C.dim }]
  const life = ttl === '1h' ? 3_600_000 : 300_000
  const left = Math.max(0, at + life - now)
  const [word, color] = left <= 0 ? ['cold', C.red] : left < life / 10 ? ['cooling', C.yellow] : ['warm', C.green]
  const detail = left > 0 ? `, ${Math.ceil(left / 60000)}m left of ${ttl}` : `, next request rewrites ${count(tokens)} tokens`
  return [
    { text: left > 0 ? '●' : '○', color },
    { text: ' ' },
    { text: word, color, bold: true },
    { text: detail, color: C.dim },
  ]
}

export type PaneInput = {
  snap: Snapshot
  agents: Agent[]
  cache: number | null
  ttl: '5m' | '1h'
  now: number
  width: number
}

export type PaneLayout = {
  // The model, the directory, then the Session and Subagents boxes.
  head: Segment[][]
  // An empty row, repeated to push the foot down to the pane's bottom.
  filler: Segment[]
  // The Usage limits box, pinned to the pane's bottom edge.
  foot: Segment[][]
}

// An agent's model by family alone: Opus, Sonnet, Haiku, or any family a new id names.
export const family = (model: string) => modelName(model).split(' ')[0]!

export type Family = { name: string; used: number; running: number; failed: number; tokens: number; ms: number }

// Opus, Sonnet and Haiku always hold their columns, in that order, so the matrix
// keeps its shape before any agent runs. A family released later comes from the
// ids and gets a column after them, in name order, with no change here.
const FAMILIES = ['Opus', 'Sonnet', 'Haiku']

export function families(list: Agent[], now: number): Family[] {
  const by = new Map<string, Family>(FAMILIES.map(name => [name, { name, used: 0, running: 0, failed: 0, tokens: 0, ms: 0 }]))
  for (const a of list) {
    const name = family(a.model)
    const f = by.get(name) ?? { name, used: 0, running: 0, failed: 0, tokens: 0, ms: 0 }
    f.used++
    if (!STOPPED.includes(a.status)) f.running++
    else if (a.status !== 'completed') f.failed++
    f.tokens += a.tokens
    f.ms += (a.endedAt ?? now) - a.startedAt
    by.set(name, f)
  }
  const rank = (name: string) => (FAMILIES.includes(name) ? FAMILIES.indexOf(name) : FAMILIES.length)
  return [...by.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}

// The speed of the last answer, coloured like the context percent: green from 40
// tok/s, yellow from 20, red below; - until one lands.
export const pace = (tps: number) => (tps >= 40 ? C.green : tps >= 20 ? C.yellow : C.red)
const speed = (s: Snapshot): Segment[] => [
  s.tps === undefined ? { text: '-', color: C.dim } : { text: `${s.tps}`, color: pace(s.tps), bold: true },
  { text: ' tok/s', color: C.dim },
]

// One row: the model, then a small square per effort level it accepts, lit up to
// the level in use, then that level.
function modelRows(s: Snapshot, w: number): Segment[][] {
  const levels = effortLevels(s.modelId)
  const lit = s.effort === undefined ? 0 : levels.indexOf(s.effort) + 1
  // A level the table does not list (or a number) keeps its word and loses the squares.
  const squares: Segment[] = levels.length && (s.effort === undefined || lit > 0)
    ? [{ text: ' ' }, { text: '▪'.repeat(lit), color: C.claude }, { text: '·'.repeat(levels.length - lit), color: C.sub }]
    : []
  const word = !levels.length ? 'no effort setting' : (s.effort ?? 'default effort')
  return [fit([{ text: modelName(s.modelId), color: C.claude, bold: true }, ...squares, { text: '  ' + word, color: C.dim }], w)]
}

// The Git box: the branch in violet, then the file counts in git status's own
// colours and the commit counts in blue. A count is lit when non-zero and dark
// when zero, so the rows keep their shape.
function gitRows(s: Snapshot, w: number): Segment[][] {
  if (!s.inRepo) return [fit([{ text: 'not a git repo', color: C.dim }], w)]
  const label = (text: string): Segment => ({ text: pad(text, 9), color: C.dim })
  const g = s.git
  const cell = (n: number, text: string, color: string): Segment => ({ text, color: n ? color : C.sub, bold: n > 0 })
  const spaced = (cells: Segment[]) => cells.flatMap((c, i) => (i ? [{ text: '  ' }, c] : [c]))
  return [
    fit([label('Branch'), s.branch ? { text: s.branch, color: C.mag } : { text: 'detached HEAD', color: C.dim }], w),
    fit([label('Changes'), ...spaced([cell(g.modified, `${g.modified} modified`, C.yellow), cell(g.staged, `${g.staged} staged`, C.green), cell(g.untracked, `${g.untracked} untracked`, C.cyan)])], w),
    fit([label('Sync'), ...spaced([cell(g.ahead, `⇡${g.ahead} ahead`, C.blue), cell(g.behind, `⇣${g.behind} behind`, C.blue)])], w),
  ]
}

// The time and when the session started, the cache sentence, the context percent
// and the speed of the last answer, then a hairline meter ending in the token count.
function sessionRows(p: PaneInput, w: number): Segment[][] {
  const s = p.snap
  const label = (text: string): Segment => ({ text: pad(text, 9), color: C.dim })
  const rows = [fit([label('Time'), { text: span(p.now - s.startedAt), color: C.fg, bold: true }, { text: `  since ${s.since}`, color: C.dim }], w)]
  const tokens: Segment[] = [{ text: `  ${count(s.tokens)} of ${count(s.window)}`, color: C.dim }]
  rows.push(
    fit([label('Cache'), ...cacheRow(p.cache, p.ttl, p.now, s.tokens)], w),
    fit([label('Context'), { text: `${Math.round(s.percent)}%`, color: threshold(s.percent), bold: true }, { text: ' at ', color: C.dim }, ...speed(s)], w),
    [...bar(s.percent, w - width(tokens)), ...tokens],
  )
  return rows
}

// Families are columns and figures are rows, with a Total column last. A family
// with no agents shows –; zero running or failed shows ·.
function agentRows(p: PaneInput, w: number): Segment[][] {
  const fams = families(p.agents, p.now)
  const total = fams.reduce((t, f) => ({ ...t, used: t.used + f.used, running: t.running + f.running, failed: t.failed + f.failed, tokens: t.tokens + f.tokens, ms: t.ms + f.ms }), { name: 'Total', used: 0, running: 0, failed: 0, tokens: 0, ms: 0 })
  const cols = [...fams, total]
  const lw = 10
  const cw = Math.max(1, Math.floor((w - lw) / cols.length))
  const line = (text: string, cell: (f: Family, last: boolean) => Segment) =>
    fit([{ text: pad(text, lw), color: C.dim }, ...cols.map((f, i) => { const c = cell(f, i === cols.length - 1); return { ...c, text: lpad(c.text, cw) } })], w)
  const value = (f: Family, last: boolean, text: string): Segment => (f.used ? { text, color: last ? C.fg : C.mid, bold: last } : { text: '–', color: C.dim })
  return [
    line('', (f, last) => ({ text: f.name, color: f.used || last ? C.fg : C.dim, bold: true })),
    line('Used', (f, last) => (f.used ? { text: `${f.used}`, color: C.fg, bold: last } : { text: '–', color: C.dim })),
    line('Running', f => (f.running ? { text: `● ${f.running}`, color: C.green, bold: true } : { text: '·', color: C.sub })),
    line('Failed', f => (f.failed ? { text: `✗ ${f.failed}`, color: C.red, bold: true } : { text: '·', color: C.sub })),
    line('Tokens', (f, last) => value(f, last, count(f.tokens))),
    line('Time', (f, last) => value(f, last, agentTime(f.ms))),
  ]
}

// One row per limit: the label, percent used, a hairline like the context meter,
// and the time to reset flush right, or ↻ – when the engine gives none. A window
// the engine stopped reporting reads ? with an empty meter and ↻ ?. Every row
// keeps the same meter width, so the meters line up whether a reset time is known or not.
// Under a rule, what the session spent and that per hour; - until the engine reports cost.
// The label column is as wide as the longest label shown, plus one space.
function limitRows(p: PaneInput, w: number): Segment[][] {
  const { limits, cost, startedAt } = p.snap
  const lw = Math.max(...[...limits.map(l => limitLabel(l.kind)), 'Spent'].map(t => t.length)) + 1
  const hours = Math.max((p.now - startedAt) / 3_600_000, 1 / 60)
  const spent =
    cost === undefined
      ? fit([{ text: pad('Spent', lw) }, { text: '-', color: C.dim }], w)
      : lr([{ text: pad('Spent', lw) }, { text: `$${cost.toFixed(2)}`, color: C.fg, bold: true }], [{ text: `$${(cost / hours).toFixed(2)} per hour`, color: C.dim }], w)
  const tail = [[{ text: '─'.repeat(w), color: C.sub }], spent]
  if (!limits.length) return [fit([{ text: 'Limits appear after the first answer.', color: C.dim }], w), ...tail]
  const bw = Math.max(4, w - lw - 4 - 2 - 11)
  const rows = limits.map(l => {
    if (l.percentUsed === undefined)
      return lr([{ text: pad(limitLabel(l.kind), lw) }, { text: lpad('?', 4), color: C.dim, bold: true }, { text: '  ' }, ...bar(0, bw)], [{ text: '↻ ?', color: C.dim }], w)
    const reset: Segment[] = [{ text: `↻ ${l.resetsAt ? span(Date.parse(l.resetsAt) - p.now) : '–'}`, color: C.dim }]
    return lr([{ text: pad(limitLabel(l.kind), lw) }, { text: lpad(`${Math.round(l.percentUsed)}%`, 4), color: threshold(l.percentUsed), bold: true }, { text: '  ' }, ...bar(l.percentUsed, bw)], reset, w)
  })
  return [...rows, ...tail]
}

// Every row is exactly `width` cells: a one-cell margin each side, boxes inside it.
export function layout(p: PaneInput): PaneLayout {
  const bw = p.width - 2
  const iw = bw - 4
  const row = (segs: Segment[]): Segment[] => [{ text: ' ' }, ...fit(segs, bw), { text: ' ' }]
  const blank = row([])
  const box = (title: string, rows: Segment[][]) => [
    row([{ text: '╭─ ', color: C.sub }, { text: title, color: C.fg, bold: true }, { text: ' ' + '─'.repeat(Math.max(0, bw - 5 - title.length)) + '╮', color: C.sub }]),
    ...rows.map(r => row([{ text: '│ ', color: C.sub }, ...fit(r, iw), { text: ' │', color: C.sub }])),
    row([{ text: '╰' + '─'.repeat(bw - 2) + '╯', color: C.sub }]),
  ]
  const head = [
    ...box('Model', modelRows(p.snap, iw)),
    ...box('Directory', wrapPath(pathTokens(p.snap.dir, p.snap.root), iw)),
    ...box('Git', gitRows(p.snap, iw)),
    ...box('Session', sessionRows(p, iw)),
    ...box('Subagents', agentRows(p, iw)),
  ]
  return { head, filler: blank, foot: box('Usage limits', limitRows(p, iw)) }
}

// ---- engine side --------------------------------------------------------------

async function compose($: Engine): Promise<Snapshot> {
  const cwd = await $.session.cwd()
  const [top, status, model, usage, current, settings, now] = await Promise.all([
    $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd }),
    $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd }),
    $.session.model(),
    $.session.usage(),
    read($, stats),
    $.settings.read(),
    $.clock.now(),
  ])
  const { tps } = current
  // The engine reports effort only with a request. When the saved level changes
  // (/effort, the model picker), the reported one is stale until the next
  // request, so drop it and show the saved level on this refresh.
  const saved = savedEffort(settings, model)
  const changed = lastSaved !== null && saved !== lastSaved
  lastSaved = saved
  if (changed) await update($, stats, s => ({ ...s, effort: undefined }))
  const effort = (changed ? undefined : current.effort) ?? saved
  const inRepo = top.exitCode === 0
  const { tokens, window, percent = 0 } = usage.context
  const dir = directory(cwd, home)
  const root = inRepo ? directory(top.stdout.trim(), home) : null
  const git = inRepo && status.exitCode === 0 ? gitStatus(status.stdout) : { branch: '', git: CLEAN }
  const minute = Math.floor(now / 60000)
  if (since.at !== usage.startedAt || since.minute !== minute) {
    const date = async (args: string[]) => (await $.process.run(['date', ...args])).stdout.trim()
    const [start, today, yesterday] = await Promise.all([
      date(['-d', `@${Math.floor(usage.startedAt / 1000)}`, '+%F %H:%M %b %-d']),
      date(['+%F']),
      date(['-d', 'yesterday 12:00', '+%F']),
    ])
    since = { at: usage.startedAt, minute, text: startLabel(start, today, yesterday) }
  }

  const kept = keepLimits(seenLimits, usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })))
  seenLimits = kept.seen

  const snapshot: Snapshot = {
    dir,
    root,
    inRepo,
    branch: git.branch,
    git: git.git,
    modelId: model,
    effort,
    tokens: tokens ?? 0,
    window,
    percent,
    tps,
    limits: kept.limits,
    cost: usage.cost?.usd,
    startedAt: usage.startedAt,
    since: since.text,
    tick: Math.floor(now / 60000),
  }
  return snapshot
}

// $.agent.list() holds the live status; a stopped agent keeps its row here.
async function syncAgents($: Engine) {
  const [listed, tracked, now] = await Promise.all([$.agent.list(), read($, agents), $.clock.now()])
  const status = new Map(listed.map(a => [a.id, a.status as string]))
  const changed = tracked.some(a => {
    const s = status.get(a.id)
    return s !== undefined && s !== a.status && !STOPPED.includes(a.status)
  })
  if (!changed) return
  await update($, agents, list =>
    list.map(a => {
      const s = status.get(a.id)
      if (s === undefined || s === a.status || STOPPED.includes(a.status)) return a
      return { ...a, status: s, endedAt: STOPPED.includes(s) ? now : undefined }
    }),
  )
}

// While an agent runs, the tick moves every refresh so its run time counts up.
const refresh = ($: Engine) =>
  Promise.all([compose($), read($, snap), syncAgents($), read($, agents), $.clock.now()])
    .then(async ([snapshot, previous, , list, now]) => {
      const live = list.some(a => !STOPPED.includes(a.status))
      const next = live ? { ...snapshot, tick: Math.floor(now / 2000) } : snapshot
      if (JSON.stringify(previous) !== JSON.stringify(next)) await update($, snap, () => next)
    })
    .catch(err => $.ui.log(`status-pane: ${err}`, { to: 'debug' }))

// Terminal only: the layout is fixed-width text in Ghostty's colours, so a session
// with no terminal attached (the desktop app, a -p run) gets no pane.
const openPane = async ($: Engine) => {
  if (!(await $.session.surfaces()).includes('terminal')) return false
  await $.ui.open({ id: PANE, title: 'status', columns: 60 })
  return true
}

export const register: Register = (on, options) => {
  paint(options)
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    home = (await $.process.run(['printenv', 'HOME'])).stdout.trim()
    await $.command.register({ name: 'status-pane', description: 'Open the status pane' })
    // The clock also picks up git changes made outside the session.
    $.clock.every(2000, () => void refresh($))
    await refresh($)
    void openPane($)
    return started
  })

  on('command.run', { command: 'status-pane' }, async $ => {
    return { text: (await openPane($)) ? 'Status pane opened.' : 'The status pane is drawn in a terminal only.' }
  })

  // Each main-loop step is timed from request sent to stream end, so tool runtime
  // between steps stays out, as in turn-tps.sh. A subagent's step adds the tokens
  // its request processed.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const response = yield* next(e)
      const u = response.usage
      if (u) {
        const id = e.agentId
        const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
        await update($, agents, list => list.map(a => (a.id === id ? { ...a, tokens: a.tokens + tokens } : a)))
      }
      return response
    }
    const start = await $.clock.now()
    const response = yield* next(e)
    const end = await $.clock.now()
    const ms = end - start
    if (turn.id !== e.turnId) turn = { id: e.turnId, out: 0, ms: 0 }
    turn.out += response.usage?.output_tokens ?? 0
    turn.ms += ms
    const effort = e.effort === undefined ? undefined : String(e.effort)
    await update($, stats, s => ({ ...s, effort }))
    if (response.usage) await update($, cache, () => end)
    return response
  })

  // A subagent's answer is its own turn.complete: it stops the agent's clock, so
  // no settings hook (which a plugin above may bypass) is needed. The main loop's
  // completion publishes the answer's output tok/s.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      const id = e.agentId
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      const now = await $.clock.now()
      await update($, agents, list => list.map(a => (a.id === id && !STOPPED.includes(a.status) ? { ...a, status, endedAt: now } : a)))
      return result
    }
    if (turn.id === e.turnId && turn.out > 0 && turn.ms > 0) {
      const tps = Math.round((turn.out * 1000) / turn.ms)
      await update($, stats, s => ({ ...s, tps }))
      void refresh($)
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.agentId) {
      const id = started.agentId
      const now = await $.clock.now()
      await update($, agents, list =>
        [
          ...list.filter(a => a.id !== id),
          {
            id,
            name: e.name ?? e.description,
            model: started.model,
            tokens: 0,
            status: 'running',
            startedAt: now,
          },
        ].slice(-200),
      )
    }
    return started
  }).catch(($, e, next) => next(e))

  // The only place the engine names the cache TTL.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await update($, ttl, () => e.cache_ttl)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [s, list, at, knownTtl, now] = await Promise.all([
      read($, snap),
      read($, agents),
      read($, cache),
      read($, ttl),
      $.clock.now(),
    ])
    if (!s) return <Text dimColor>status-pane: waiting for the first refresh</Text>
    // Until a model switch names it: subscriptions cache for 1h, API keys for 5m.
    const cacheTtl = knownTtl ?? (s.limits.length ? '1h' : '5m')
    const rows = e.props.scroll.bodyRows
    const p = layout({ snap: s, agents: list, cache: at, ttl: cacheTtl, now, width: e.props.bodyColumns })
    const spacer = Math.max(0, rows - p.head.length - p.foot.length)
    const row = (segs: Segment[], key: string) => (
      <Text key={key} wrap="truncate-end">
        {segs.map((seg, i) => (
          <Text key={String(i)} color={seg.color} backgroundColor={seg.bg} bold={seg.bold} dimColor={seg.dim}>
            {seg.text}
          </Text>
        ))}
      </Text>
    )
    return (
      <Box flexDirection="column">
        {p.head.map((r, i) => row(r, `h${i}`))}
        {Array.from({ length: spacer }, (_, i) => row(p.filler, `x${i}`))}
        {p.foot.map((r, i) => row(r, `f${i}`))}
      </Box>
    )
  })
}
