import { test, expect } from 'claude-code/testing'
import { createFocus, start, adjust, progress, restoreFocus, streaks, focusTimer, tickFocus, dayOf } from '../hooks/focus.mjs'
import { createPet, petTick, petSaved, restorePet } from '../hooks/pet.mjs'
import { fitSections } from '../hooks/bands.mjs'
import { state } from '../hooks/state.mjs'
import { frameKey } from '../hooks/squad-chat.mjs'
import { createToolbox, rerun, pickTool } from '../hooks/toolbox.mjs'
import { createHabits, addHabit, deleteHabit, habitStreaks } from '../hooks/habits.mjs'
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

test('Habits: ✕ deletes the habit pressed, even one named with a number', () => {
  const h = createHabits()
  addHabit(h, 'Read')
  addHabit(h, 'Run')
  addHabit(h, '2')
  const done = deleteHabit(h, 'h3')
  expect(done?.said).toBe('Removed 2 and its streak.')
  expect(h.goals.map((g: any) => g.name)).toEqual(['Read', 'Run'])
})

test('Habits: "x8" after a space counts the times a day; an x inside a word is the name', () => {
  const h = createHabits()
  for (const t of ['Water x8', 'Tea×3', 'Stretch *2', 'Inbox 0', 'Relax 5', 'Fix 2']) addHabit(h, t)
  expect(h.goals.map((g: any) => [g.name, g.target])).toEqual([
    ['Water', 8], ['Tea', 3], ['Stretch', 2], ['Inbox 0', 1], ['Relax 5', 1], ['Fix 2', 1],
  ])
})

test('Redraws while Claude works: a second at a time only for rooms that move by the second', () => {
  const at = 10 * MIN + 5_000
  for (const view of ['habits', 'toolbox', 'clipboard', 'pet', 'usage']) expect(frameKey(view, at)).toBe(frameKey(view, at + 1_000))
  for (const view of ['focus', 'agents', 'git']) expect(frameKey(view, at)).not.toBe(frameKey(view, at + 1_000))
  expect(frameKey('habits', at)).not.toBe(frameKey('habits', at + MIN))   // a new day still shows
})

test('Habits: the streak running and the longest, a year back at most', () => {
  const now = new Date(2026, 9, 14, 9).getTime()
  const day = (n: number) => dayOf(new Date(2026, 9, 14 - n, 12).getTime())
  const h = createHabits()
  addHabit(h, 'Run')
  // Yesterday and the two days before; five in a row before that; one too old to keep.
  h.history.h1 = Object.fromEntries([1, 2, 3, 10, 11, 12, 13, 14, 400].map((n) => [day(n), 1]))
  expect(habitStreaks(h, h.goals[0], now)).toEqual({ current: 3, best: 5 })
  h.history.h1[day(0)] = 1
  expect(habitStreaks(h, h.goals[0], now)).toEqual({ current: 4, best: 5 })
})

test('Toolbox: a run that ends after a newer one began is dropped', async () => {
  const tb = createToolbox()
  tb.tool = 'hash'
  tb.input = 'x'.repeat(200_000)
  const hashing = rerun(tb, Date.now())           // the digest takes a while
  await pickTool(tb, 'uuid', Date.now())          // UUID picked before it's done
  await hashing
  expect(tb.tool).toBe('uuid')
  expect(tb.out.mode).toBe('v4 ×5')
  expect(tb.out.rows.every((r: any) => r.label === '')).toBe(true)
})

test('Requests: a request that fails hands what it carried to the retry, measured from the last that came back', () => {
  const u = createUsage()
  const usage = (input: number, output: number) => ({ input_tokens: 500, cache_read_input_tokens: input - 500, cache_creation_input_tokens: 0, output_tokens: output })
  stepPrompt(u, 'look around')
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), usage(100_000, 100), 'tool_use')
  stepToolResult(u, 'Read', 16_000, 'habits.mjs')
  const broke = stepStarted(u, { turnId: 't', index: 1, at: 0 })
  stepEnded(u, broke, null, null)                                    // the stream broke
  expect(broke.status).toBe('failed')
  const retry = stepStarted(u, { turnId: 't', index: 1, at: 0 })
  expect(retry.added.map((p: any) => p.label)).toEqual(['Read habits.mjs'])
  stepEnded(u, retry, usage(104_100, 100), 'end_turn')
  expect(retry.grown).toBe(4_000)
  expect(retry.added[0].tokens).toBe(4_000)
})
