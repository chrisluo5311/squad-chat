import { test, expect } from 'claude-code/testing'
import { createFocus, start, adjust, progress, restoreFocus, streaks, focusTimer, tickFocus, dayOf } from '../hooks/focus.mjs'
import { createPet, petTick, petSaved, restorePet } from '../hooks/pet.mjs'
import { fitSections } from '../hooks/bands.mjs'
import { state } from '../hooks/state.mjs'
import { toolSummary, createUsage, stepPrompt, stepToolResult, stepStarted, stepToolUse, stepEnded, applyOverhead, strata, contextTips } from '../hooks/metrics.mjs'

const MIN = 60_000

test('Focus: − or + while a round runs leaves its progress alone', () => {
  const f = createFocus()
  start(f, 0)
  expect(Math.round(progress(f, 5 * MIN) * 100)).toBe(20)
  for (let i = 0; i < 4; i++) adjust(f, 'work', -1)   // 25 → 5 for the next round
  expect(f.work).toBe(5)
  expect(Math.round(progress(f, 5 * MIN) * 100)).toBe(20)
  expect(tickFocus(f, 10 * MIN)).toBeNull()            // still ends at 25
  expect(tickFocus(f, 25 * MIN)).toBe('focus')
})

test('Focus: a timer that ran out while no session was there is let go, not counted', () => {
  const now = Date.now()
  const running = { phase: 'focus', endsAt: now - 9 * 3_600_000, left: 0, paused: false, span: 25 * MIN }
  const f = createFocus()
  restoreFocus(f, null, running, now)
  expect(f.phase).toBe('idle')
  expect(tickFocus(f, now)).toBeNull()
  expect(f.done).toBe(0)
  // A reload a moment after the end still finishes the round.
  const g = createFocus()
  restoreFocus(g, null, { ...running, endsAt: now - 2_000 }, now)
  expect(tickFocus(g, now)).toBe('focus')
  expect(g.done).toBe(1)
  // And the phase's length comes back with it.
  const h = createFocus()
  start(h, now)
  const k = createFocus()
  restoreFocus(k, null, focusTimer(h), now)
  expect(k.span).toBe(25 * MIN)
})

test('Focus: the streak and the best run, from the days with a round', () => {
  const now = Date.now()
  const day = (n: number) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return dayOf(d.getTime()) }
  const f = createFocus()
  f.history = { [day(0)]: 1, [day(1)]: 2, [day(5)]: 1, [day(6)]: 1, [day(7)]: 3, [day(400)]: 1 }
  expect(streaks(f, now)).toEqual({ current: 2, best: 3 })
  f.history = { [day(1)]: 1 }
  expect(streaks(f, now)).toEqual({ current: 1, best: 1 })
})

test('Pet: failing checks are noted once, not again after a reload', () => {
  const p = createPet()
  state.pet = p
  petTick(p, { busy: false, failing: true, now: 1_000 })
  expect(p.log.filter((x) => x.text.startsWith('Checks failed')).length).toBe(1)
  const q = createPet()
  restorePet(q, petSaved(p))
  state.pet = q
  petTick(q, { busy: false, failing: null, now: 2_000 })   // before the Git room's first look
  petTick(q, { busy: false, failing: true, now: 3_000 })
  expect(q.log.filter((x) => x.text.startsWith('Checks failed')).length).toBe(1)
})

test('band: ‹ › take room from the sections beside Open', () => {
  const s = (key: string) => ({ key, color: '#fff', parts: [{ text: 'x'.repeat(10), kind: 'value' }] })
  const list = [s('a'), s('b'), s('c'), s('d'), s('e')]
  let fewer = 0
  for (let columns = 40; columns <= 120; columns++) {
    const plain = fitSections(list, '◷ Focus', columns).length
    const cycle = fitSections(list, '◷ Focus', columns, { cycle: true }).length
    expect(cycle).toBeLessThanOrEqual(plain)
    if (cycle < plain) fewer++
  }
  expect(fewer).toBeGreaterThan(0)
})

test('Requests strata: in a long session the earlier conversation is bedrock, so what comes after shows', () => {
  // Watching starts hours in: 79k of overhead and 310k of conversation are already there.
  const u = createUsage()
  const usage = (input: number, output: number) => ({ input_tokens: 500, cache_read_input_tokens: input - 500, cache_creation_input_tokens: 0, output_tokens: output })
  stepPrompt(u, 'test the card')
  const a = stepStarted(u, { turnId: 't', index: 0, at: 0 })
  stepToolUse(a, 'Read'); stepToolUse(a, 'Bash')
  stepEnded(u, a, usage(389_000, 400), 'tool_use')
  stepToolResult(u, 'Read', 10_000, 'metrics.mjs'); stepToolResult(u, 'Bash', 200, 'git log --oneline -5')
  stepEnded(u, stepStarted(u, { turnId: 't', index: 1, at: 0 }), usage(392_000, 900), 'end_turn')
  applyOverhead(u, { categories: [{ name: 'System tools', tokens: 32_000, kind: 'used' }, { name: 'MCP tools', tokens: 47_000, kind: 'used' }, { name: 'Messages', tokens: 310_000, kind: 'used' }] })
  u.context = { tokens: 392_900, window: 1_000_000, percent: 39 } as any

  const st = strata(u)!
  expect(st.bedrock).toBe(79_000)
  expect(st.earlier).toBeGreaterThan(309_000)                       // the history from before #1, kept out of the scale
  expect(Math.round(st.bedrock + st.earlier + st.cols.at(-1).above)).toBe(392_900)   // the sum comes to the context: the last input, 392k, and its 900 out
  expect(st.cols.map((c: any) => c.label)).toEqual(['first', 'older', 'next'])
  expect(st.cols.at(-1).above).toBeLessThan(5_000)                  // what came after: the Read and two answers
  const read = st.layers.find((l: any) => l.name === 'Read metrics.mjs')!
  expect(read.sizes.at(-1)).toBeGreaterThan(2_000)                  // big enough to see against the rest
  expect(st.layers.find((l: any) => l.name === "Claude's tool calls")).toBeDefined()

  const tips = contextTips(u).map((t: any) => t.parts.map((p: any) => p[0]).join(''))
  expect(tips[1]).toMatch(/^Read metrics\.mjs \(2\.\dk\): read once, resent 1 time so far \(2\.\dk sent in all\)\.$/)
  expect(tips[2]).toMatch(/^The next request sends 39\dk, 39% of the window\.$/)
})

test('a Bash summary skips a leading cd, so it names the command that runs', () => {
  expect(toolSummary('Bash', { command: 'cd /Users/me/程式/squad-chat/plugins && grep -n "step" hooks/*.mjs' })).toBe('grep -n "step" hooks/*.mjs')
  expect(toolSummary('Bash', { command: 'cd "/tmp/a b"; ls' })).toBe('ls')
  expect(toolSummary('Bash', { command: 'npm test' })).toBe('npm test')
})

test('Requests tip: a file read once is said to be resent, never read again', () => {
  const u = createUsage()
  const usage = (input: number, output: number) => ({ input_tokens: 500, cache_read_input_tokens: input - 500, cache_creation_input_tokens: 0, output_tokens: output })
  const step = (input: number, output: number, tools: string[] = []) => {
    const s = stepStarted(u, { turnId: 't', index: 0, at: 0 })
    tools.forEach((t) => stepToolUse(s, t))
    stepEnded(u, s, usage(input, output), tools.length ? 'tool_use' : 'end_turn')
  }
  stepPrompt(u, 'look around')
  step(100_000, 100, ['Read'])
  stepToolResult(u, 'Read', 16_800, 'habits.mjs')   // about 4.2k
  step(104_300, 100, ['Bash'])
  stepToolResult(u, 'Bash', 1_600, 'git log')
  step(104_800, 100, ['Read'])
  stepToolResult(u, 'Read', 6_000, 'README.md')
  step(106_400, 300)
  const tips = contextTips(u).map((t: any) => t.parts.map((p: any) => p[0]).join(''))
  expect(tips.find((t: string) => t.startsWith('Read habits.mjs'))).toBe('Read habits.mjs (4.2k): read once, resent 3 times so far (13k sent in all).')
})
