// One run of a pane row: text with its colour and, for bands and chips, a background.
export type Segment = { text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean }

// Kept in $.state so a hot reload does not lose them.
export type Stats = { tps?: number; effort?: string }

// git status as counts: files modified, staged and untracked, commits ahead and behind.
export type GitFlags = { modified: number; staged: number; untracked: number; ahead: number; behind: number }

// What the pane draws from, refreshed every 2s. `tick` changes each minute so
// the countdowns redraw, and every 2s while an agent runs.
export type Snapshot = {
  // The working directory, with ~ for $HOME.
  dir: string
  // The repo's top folder in the same form; null outside a git work tree.
  root: string | null
  // False outside a git work tree; a detached HEAD is in a repo with no branch.
  inRepo: boolean
  branch: string
  git: GitFlags
  modelId: string
  effort?: string
  tokens: number
  window: number
  percent: number
  tps?: number
  limits: { kind: string; percentUsed?: number; resetsAt?: string }[]
  cost?: number
  startedAt: number
  since: string
  tick: number
}

// A subagent as the pane counts it; `tokens` is the sum over its steps of the
// input, cache and output tokens each request processed.
export type Agent = {
  id: string
  name: string
  model: string
  tokens: number
  status: string
  startedAt: number
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'status-pane': {
      stats: Stats
      snap: Snapshot | null
      agents: Agent[]
      // End of the last main-thread response, in epoch ms.
      cache: number | null
      ttl: '5m' | '1h' | null
    }
  }
}
