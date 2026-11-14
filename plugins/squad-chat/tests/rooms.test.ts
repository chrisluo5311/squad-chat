import { test, expect } from 'claude-code/testing'
import { createFocus, start, adjust, progress, restoreFocus, streaks, focusTimer, tickFocus, dayOf } from '../hooks/focus.mjs'
import { createPet, petTick, petSaved, restorePet } from '../hooks/pet.mjs'
import { fitSections } from '../hooks/bands.mjs'
import { shortTool, trajectoryText } from '../hooks/trajview.mjs'
import { usageSections } from '../hooks/usageband.mjs'
import { state } from '../hooks/state.mjs'
import { frameKey, breakdownWanted } from '../hooks/squad-chat.mjs'
import { createToolbox, rerun, pickTool, toolWords, MAX_INPUT } from '../hooks/toolbox.mjs'
import { createHabits, addHabit, deleteHabit, habitStreaks } from '../hooks/habits.mjs'
import { noteProvider, serverLabel, toolSummary, createUsage, stepPrompt, stepToolResult, stepStarted, stepChunk, stepEnded, traceCall, traceEnded, agentSpawned, applyOverhead, trajectory, trajectoryTotals, trajectoryLive, preview } from '../hooks/metrics.mjs'

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

test('a Bash summary skips a leading cd, so it names the command that runs', () => {
  expect(toolSummary('Bash', { command: 'cd /Users/me/程式/squad-chat/plugins && grep -n "step" hooks/*.mjs' })).toBe('grep -n "step" hooks/*.mjs')
  expect(toolSummary('Bash', { command: 'cd "/tmp/a b"; ls' })).toBe('ls')
  expect(toolSummary('Bash', { command: 'npm test' })).toBe('npm test')
})

test('a file summary is its name: on Windows a path splits at \\ too, elsewhere only at /', () => {
  expect(toolSummary('Read', { file_path: 'C:\\Users\\me\\squad-chat\\hooks\\metrics.mjs' }, 'win32')).toBe('metrics.mjs')
  expect(toolSummary('Edit', { file_path: 'C:/Users/me/squad-chat/README.md' }, 'win32')).toBe('README.md')
  expect(toolSummary('Read', { file_path: '/Users/me/a\\b.txt' }, 'darwin')).toBe('a\\b.txt')
  expect(toolSummary('Read', { file_path: '/Users/me/squad-chat/hooks/metrics.mjs' })).toBe('metrics.mjs')
})

test('a Skill summary names the skill and its arguments', () => {
  expect(toolSummary('Skill', { skill: 'caveman' })).toBe('caveman')
  expect(toolSummary('Skill', { skill: 'code-review', args: 'high --fix' })).toBe('code-review high --fix')
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
  // Usage while a call runs: its timer on the Trajectory card and the band counts by the second.
  const saved = state.usage
  const u = createUsage()
  state.usage = u
  try {
    stepPrompt(u, 'go', 0)
    stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), { usage: { input_tokens: 1_000, output_tokens: 10 }, answer: '', stopReason: 'tool_use' }, 10)
    traceCall(u, 'k1', { tool: 'Bash', input: { command: 'sleep 90' }, at: 20 })
    expect(frameKey('usage', at)).not.toBe(frameKey('usage', at + 1_000))
    traceEnded(u, 'k1', { at: 30, isError: false })
    expect(frameKey('usage', at)).toBe(frameKey('usage', at + 1_000))   // idle again: back to the minute
  } finally {
    state.usage = saved
  }
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

test('Toolbox: what a tool runs on is cut to its limit', async () => {
  const tb = createToolbox()
  await toolWords(tb, 'count', Date.now(), { typed: true })
  await toolWords(tb, 'a '.repeat(MAX_INPUT), Date.now(), { typed: true })
  expect(tb.input.length).toBe(MAX_INPUT)
  expect(tb.out.rows[0].text).toBe(String(MAX_INPUT))
})

// A request's usage as the API gives it, and turn.step's result around it.
const usageOf = (input: number, output: number) => ({ input_tokens: 500, cache_read_input_tokens: input - 500, cache_creation_input_tokens: 0, output_tokens: output })
const stepResult = (input: number, output: number, answer = '', stopReason = 'tool_use') => ({ usage: usageOf(input, output), answer, stopReason })

test('Trajectory: a prompt starts a turn, each request is a step of it, and its calls hang under it', () => {
  const u = createUsage()
  stepPrompt(u, 'fix the card', 0)
  const a = stepStarted(u, { turnId: 't', index: 0, at: 1_000 })
  stepChunk(a, 1_400)
  stepChunk(a, 1_500)                                                  // only the first piece times the start
  stepEnded(u, a, stepResult(100_000, 120, 'Let me read it.'), 2_000)
  expect([a.firstAt, a.endedAt, a.text]).toEqual([1_400, 2_000, 'Let me read it.'])
  traceCall(u, 'k1', { tool: 'Read', input: { tool: 'Read', file_path: '/src/metrics.mjs' }, at: 2_100 })
  expect(trajectoryLive(u)?.call?.tool).toBe('Read')                    // the band says what is under way
  traceEnded(u, 'k1', { at: 2_200, isError: false })
  stepToolResult(u, 'k1', 'one\ntwo\nthree\nfour')
  const b = stepStarted(u, { turnId: 't', index: 1, at: 2_300 })
  stepEnded(u, b, stepResult(104_120, 50, 'Done.', 'end_turn'), 3_000)

  const [turn] = trajectory(u)
  expect(turn.prompt).toBe('fix the card')
  expect(turn.steps.map((s: any) => s.n)).toEqual([1, 2])
  const call = a.calls[0]
  expect(call.summary).toBe('metrics.mjs')
  expect(call.ms).toBe(100)
  expect(call.input).toEqual([['file_path', '/src/metrics.mjs']])     // its input, without the event's own fields
  expect(call.lines).toEqual(['one', 'two', 'three'])                 // the first lines of its result
  expect(call.tokens).toBe(4_000)                                     // all the next request grew by: it carried only this
  const tt = trajectoryTotals(u)
  expect([tt.turns, tt.requests, tt.calls]).toEqual([1, 2, 1])
  expect(tt.tps).toBe(200)                                            // 120 tokens over the 0.6 s after the first piece
  expect(tt.next).toBe(104_170)
  expect(trajectoryLive(u)).toBeNull()
})

test("Trajectory: a subagent's calls hang under the Agent call that started it, and stay out of the next request", () => {
  const u = createUsage()
  stepPrompt(u, 'look around', 0)
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(100_000, 100), 10)
  traceCall(u, 'k1', { tool: 'Agent', input: { description: 'map the repo', subagent_type: 'Explore' }, at: 20 })
  agentSpawned(u, { id: 'a1', type: 'Explore', description: 'map the repo', parentId: null, at: 25 })
  traceCall(u, 'k2', { tool: 'Grep', agentId: 'a1', input: { pattern: 'strata' }, at: 30 })
  traceEnded(u, 'k2', { at: 40, isError: false })
  stepToolResult(u, 'k2', 'hooks/metrics.mjs:12')
  expect(traceCall(u, 'k3', { tool: 'Read', agentId: 'compactor', input: {}, at: 50 })).toBeNull()   // the engine's own loops aren't ours
  const agent = u.steps[0].calls[0]
  expect(agent.agent).toEqual({ id: 'a1', type: 'Explore' })
  expect(agent.sub.map((c: any) => c.summary)).toEqual(['"strata"'])
  expect(u.stepIn).toEqual([])                                        // a subagent's results go to it, not to Claude
})

test("Trajectory: a long Agent call outlives hundreds of its subagent's calls and still finds its end", () => {
  const u = createUsage()
  stepPrompt(u, 'look around', 0)
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(100_000, 100), 10)
  traceCall(u, 'A', { tool: 'Agent', input: { description: 'map the repo' }, at: 20 })
  agentSpawned(u, { id: 'a1', type: 'Explore', description: 'map the repo', parentId: null, at: 25 })
  for (let i = 0; i < 450; i++) {
    traceCall(u, `s${i}`, { tool: 'Grep', agentId: 'a1', input: {}, at: 30 + i })
    traceEnded(u, `s${i}`, { at: 31 + i, isError: false })
  }
  expect(u.traced.size).toBeLessThanOrEqual(200)
  expect(traceEnded(u, 'A', { at: 900, isError: false })).toBe(true)
  expect(trajectoryLive(u)).toBeNull()
})

test('Trajectory: the totals count the whole session, past the rows still kept', () => {
  const u = createUsage()
  for (let t = 0; t < 12; t++) {
    stepPrompt(u, `prompt ${t}`, t * 1_000)
    for (let i = 0; i < 5; i++) {
      const s = stepStarted(u, { turnId: `t${t}`, index: i, at: t * 1_000 + i * 10 })
      stepEnded(u, s, stepResult(100_000 + (t * 5 + i) * 10, 5), t * 1_000 + i * 10 + 5)
      for (let c = 0; c < 3; c++) traceCall(u, `k${t}-${i}-${c}`, { tool: 'Read', input: {}, at: t * 1_000 + i * 10 + 6 })
    }
  }
  expect(u.steps).toHaveLength(30)                                    // the rows: the newest 30 requests
  const tt = trajectoryTotals(u)
  expect([tt.turns, tt.requests, tt.calls]).toEqual([12, 60, 180])
  // An agent's calls likewise: every one counted, the newest kept.
  traceCall(u, 'A', { tool: 'Agent', input: { description: 'map the repo' }, at: 20_000 })
  agentSpawned(u, { id: 'a1', type: 'Explore', description: 'map the repo', parentId: null, at: 20_001 })
  for (let i = 0; i < 300; i++) traceCall(u, `s${i}`, { tool: 'Grep', agentId: 'a1', input: {}, at: 20_002 + i })
  const agent = u.steps.at(-1).calls.at(-1)
  expect([agent.sub.length, agent.subN]).toEqual([40, 300])
  expect(trajectoryTotals(u).calls).toBe(481)
})

test('Trajectory: the text Share sends always fits a snippet, the oldest requests giving way', () => {
  const saved = state.usage
  const u = createUsage()
  state.usage = u
  try {
    stepPrompt(u, 'go', 0)
    for (let i = 0; i < 30; i++) {
      stepEnded(u, stepStarted(u, { turnId: 't', index: i, at: i * 100 }), stepResult(100_000 + i * 10, 5), i * 100 + 50)
      for (let c = 0; c < 3; c++) {
        traceCall(u, `k${i}-${c}`, { tool: 'Bash', input: { command: `npm run build --workspace packages/some-long-package-name-${i}-${c} -- --verbose` }, at: i * 100 + 60 })
        traceEnded(u, `k${i}-${c}`, { at: i * 100 + 70, isError: false })
      }
    }
    traceCall(u, 'A', { tool: 'Agent', input: { description: 'map the repo' }, at: 3_000 })
    agentSpawned(u, { id: 'a1', type: 'Explore', description: 'map the repo', parentId: null, at: 3_001 })
    for (let i = 0; i < 300; i++) traceCall(u, `s${i}`, { tool: i % 3 ? 'Grep' : 'Read', agentId: 'a1', input: {}, at: 3_002 + i })
    const whole = trajectoryText(4_000)
    expect(whole.length).toBeGreaterThan(8_000)                       // Copy takes all of it
    expect(whole).toContain('\n  #1  ')
    expect(whole).toContain('      300 calls of its own: Grep ×200, Read ×100')   // an agent's calls on one line
    const shared = trajectoryText(4_000, { maxChars: 8_000, maxLines: 200 })
    expect(shared.length).toBeLessThanOrEqual(8_000)
    expect(shared.split('\n').length).toBeLessThanOrEqual(200)
    expect(shared).toMatch(/^Trajectory · 30 requests to Claude · 391 tool calls\n\d+ earlier requests? not listed\n/)
    expect(shared).not.toContain('\n  #1  ')
    expect(shared).toContain('\n  #30  ')                              // the newest stay
  } finally {
    state.usage = saved
  }
})

test("Trajectory: a turn with no words is still a turn, and a result the card lost still goes with the next request", () => {
  const u = createUsage()
  stepPrompt(u, 'first', 0)
  stepEnded(u, stepStarted(u, { turnId: 't1', index: 0, at: 0 }), stepResult(100_000, 100), 10)
  stepPrompt(u, '', 20)                                               // an image alone
  const b = stepStarted(u, { turnId: 't2', index: 0, at: 30 })
  expect(b.turnN).toBe(2)
  stepToolResult(u, 'gone', 'x'.repeat(400), { tool: 'Read' })        // traced before a reload
  expect(u.stepIn.map((p: any) => [p.label, p.chars])).toEqual([['Read', 400]])
  stepToolResult(u, 'gone2', 'y', { tool: 'Grep', agentId: 'a9' })    // a subagent's stays out
  expect(u.stepIn).toHaveLength(1)
})

test('Trajectory: a secret on any line of a prompt is masked', () => {
  expect(preview('deploy it, my env:\nGITHUB_TOKEN=abcdefgh12345')).toBe('(hidden: looks secret)')
})

test('Trajectory: a teammate is not taken for the Agent call that is running', () => {
  const u = createUsage()
  stepPrompt(u, 'go', 0)
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(1_000, 10), 10)
  traceCall(u, 'A1', { tool: 'Agent', input: { description: 'map the repo' }, at: 20 })
  traceCall(u, 'A2', { tool: 'Agent', input: { description: 'read the docs' }, at: 21 })
  agentSpawned(u, { id: 'x', type: 'teammate', description: 'review', parentId: null, at: 22 })
  expect(u.steps[0].calls.map((c: any) => c.agent)).toEqual([null, null])
  agentSpawned(u, { id: 'a2', type: 'Explore', description: 'read the docs', parentId: null, at: 23 })
  expect(u.steps[0].calls[1].agent).toEqual({ id: 'a2', type: 'Explore' })
})

test('Trajectory: a request that fails hands what it carried to the retry, measured from the last that came back', () => {
  const u = createUsage()
  stepPrompt(u, 'look around', 0)
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(100_000, 100), 10)
  traceCall(u, 'k1', { tool: 'Read', input: { file_path: '/a/habits.mjs' }, at: 20 })
  traceEnded(u, 'k1', { at: 30, isError: false })
  stepToolResult(u, 'k1', 'x'.repeat(16_000))
  const broke = stepStarted(u, { turnId: 't', index: 1, at: 40 })
  stepEnded(u, broke, null, 50)                                        // the stream broke
  expect(broke.status).toBe('failed')
  const retry = stepStarted(u, { turnId: 't', index: 1, at: 60 })
  expect(retry.added.map((p: any) => p.label)).toEqual(['Read'])
  stepEnded(u, retry, stepResult(104_100, 100, '', 'end_turn'), 70)
  expect(retry.grown).toBe(4_000)
  expect(u.steps[0].calls[0].tokens).toBe(4_000)
})

test('Trajectory: what looks secret is masked in every preview', () => {
  const key = `sk-ant-${'x'.repeat(24)}`
  expect(preview(`use ${key} for it`)).toBe('(hidden: looks secret)')
  const u = createUsage()
  stepPrompt(u, `deploy with ${key}`, 0)
  expect(u.turns[0].prompt).toBe('(hidden: looks secret)')
  stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(100_000, 100), 10)
  traceCall(u, 'k1', { tool: 'Bash', input: { command: `curl -H "x-api-key: ${key}" api` }, at: 20 })
  stepToolResult(u, 'k1', `KEY=${key}`)
  const call = u.steps[0].calls[0]
  expect(call.input).toEqual([['command', '(hidden: looks secret)']])
  expect(call.lines).toEqual(['(hidden: looks secret)'])
  expect(preview('a'.repeat(300)).length).toBe(200)                    // cut, an ellipsis last
  traceCall(u, 'k2', { tool: 'Plan', input: { items: [{ content: 'Count files', status: 'in_progress' }], scope: 'continuation' }, at: 30 })
  expect(u.steps[0].calls[1].input).toEqual([['items', '[\n  {\n    "content": "Count files",\n    "status": "in_progress"\n  }\n]'], ['scope', 'continuation']])   // a list as indented JSON, whole
})

test("Trajectory: a full breakdown names what is in each of FIXED's categories, MCP tools by server", () => {
  const u = createUsage()
  const categories = [{ name: 'System tools', tokens: 7_300, kind: 'used' }, { name: 'MCP tools', tokens: 3_700, kind: 'used' }, { name: 'Messages', tokens: 9_000, kind: 'used' }]
  applyOverhead(u, {
    categories,
    systemTools: [{ name: 'Read', tokens: 2_100 }, { name: 'Bash', tokens: 5_200 }],
    deferredBuiltinTools: [{ name: 'Cron', tokens: 600, isLoaded: false }],
    mcpTools: [
      { name: 'mcp__claude-in-chrome__navigate', serverName: 'claude-in-chrome', tokens: 800 },
      { name: 'mcp__claude-in-chrome__computer', serverName: 'claude-in-chrome', tokens: 2_900 },
      { name: 'mcp__plugin_vercel_vercel__deploy', serverName: '88f9b68b-1c55-4820-a103-68a1cbc34a5c', tokens: 1_200 },
      { name: 'mcp__plugin_vercel_vercel__update_project', serverName: '88f9b68b-1c55-4820-a103-68a1cbc34a5c', tokens: 12_000, isLoaded: false },
    ],
    mcpInstructions: [{ serverName: 'claude-in-chrome', tokens: 900 }],
    memoryFiles: [{ path: '/p/CLAUDE.md', type: 'Project', tokens: 3_100 }],
  })
  expect(u.overhead.tokens).toBe(11_000)                              // the conversation itself isn't overhead
  const parts = Object.fromEntries(u.overhead.parts.map((p: any) => [p.key, p]))
  expect(parts.tools.items.map((x: any) => x.name)).toEqual(['Bash', 'Read'])   // the biggest first
  expect(parts.tools.note).toBe('2 loaded · 1 deferred')
  expect(parts.mcp.groups.map((g: any) => [serverLabel(u, g), g.tokens])).toEqual([['claude-in-chrome', 3_700], ['plugin_vercel_vercel', 1_200]])   // an id gives way to the name its tools carry
  expect(parts.mcp.groups[0].items.map((x: any) => x.name)).toEqual(['computer', 'navigate'])
  expect(parts.mcp.note).toBe('By server · 2 servers · 1 not loaded')   // a deferred tool isn't sent with every request: counted apart, not listed
  expect(parts.mcp.tokens).toBe(4_900)
  expect(parts.memory.items[0]).toMatchObject({ name: '/p/CLAUDE.md', kind: 'Project' })
  expect(parts.mcpInstructions.items).toEqual([{ name: 'claude-in-chrome', tokens: 900 }])
  applyOverhead(u, { categories })                                    // a summary later keeps the items it can't name
  expect(u.overhead.parts).toHaveLength(4)
  // A connector whose server and tools both carry an id: "Connector" and its tools, until tool.describe names it.
  applyOverhead(u, { categories, mcpTools: [
    { name: 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__update', serverName: '1a59c906-04da-521d-bda7-7f71b9f9e01c', tokens: 286 },
    { name: 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__guide', serverName: '1a59c906-04da-521d-bda7-7f71b9f9e01c', tokens: 203 },
  ] })
  const docs = u.overhead.parts.find((p: any) => p.key === 'mcp').groups[0]
  expect(serverLabel(u, docs)).toBe('Connector · update, guide')
  // The provider as tool.describe gives it: { plugin: "mcp:<server>", tier }.
  expect(noteProvider(u, 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__update', { plugin: 'mcp:1a59c906-04da-521d-bda7-7f71b9f9e01c', tier: 'user' })).toBe(false)   // an id names nothing
  expect(serverLabel(u, docs)).toBe('Connector · update, guide')
  expect(noteProvider(u, 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__guide', { plugin: 'mcp:claude.ai Claude Docs', tier: 'user' })).toBe(true)
  expect(noteProvider(u, 'Read', { plugin: 'engine', tier: 'core' })).toBe(false)   // only MCP tools
  expect(serverLabel(u, docs)).toBe('claude.ai Claude Docs')
})

test('Trajectory: FIXED left open asks for the full breakdown again only while the Usage room is on show', () => {
  const saved = { usage: state.usage, view: state.view, sysRooms: state.sysRooms, paneShown: state.paneShown, sel: state.traj.sel }
  const u = createUsage()
  Object.assign(state, { usage: u, view: 'usage', sysRooms: ['usage'], paneShown: true })
  state.traj.sel = 'fixed'
  try {
    stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(1_000, 10), 10)
    expect(breakdownWanted()).toBe('full')                              // the row is open and its lists unread
    applyOverhead(u, { categories: [{ name: 'System tools', tokens: 7_300, kind: 'used' }], systemTools: [{ name: 'Read', tokens: 7_300 }] })
    expect(breakdownWanted()).toBeNull()                                // read: fresh for a few requests
    for (let i = 1; i <= 8; i++) stepEnded(u, stepStarted(u, { turnId: 't', index: i, at: i * 10 }), stepResult(1_000, 10), i * 10 + 5)
    expect(breakdownWanted()).toBe('full')                              // on show: the lists are read again
    state.paneShown = false
    expect(breakdownWanted()).toBe('summary')                           // the pane shut: the totals alone, which cost nothing
    Object.assign(state, { paneShown: true, view: 'chat' })
    expect(breakdownWanted()).toBe('summary')                           // another room on show
    Object.assign(state, { view: 'usage' })
    state.traj.sel = null
    expect(breakdownWanted()).toBe('summary')                           // the row closed
  } finally {
    Object.assign(state, { usage: saved.usage, view: saved.view, sysRooms: saved.sysRooms, paneShown: saved.paneShown })
    state.traj.sel = saved.sel
  }
})

test('band: an MCP tool is named by its own name', () => {
  expect(shortTool('mcp__ccd_turn__update_plan')).toBe('update_plan')
  expect(shortTool('Read')).toBe('Read')
})

test('band: the trajectory after the 5-hour window, always, in the largest form that fits; no 7-day window', () => {
  const saved = state.usage
  const u = createUsage()
  state.usage = u
  try {
    u.context = { tokens: 149_000, window: 1_000_000, percent: 15 } as any
    u.ctxHistory = [100_000, 110_000, 120_000, 130_000, 140_000, 144_000, 149_000]
    u.rateLimits = [{ kind: 'five_hour', percentUsed: 88 }, { kind: 'seven_day', percentUsed: 70 }] as any
    stepPrompt(u, 'go', 0)
    stepEnded(u, stepStarted(u, { turnId: 't', index: 0, at: 0 }), stepResult(1_000, 10), 10)
    traceCall(u, 'k1', { tool: 'mcp__ccd_turn__update_plan', input: {}, at: 20 })
    const keys = (cols: number) => fitSections(usageSections(1_000, cols), '◔ Usage', cols, { cycle: true })
    const traj = (cols: number) => keys(cols).find((x: any) => x.key === 'trajectory')?.parts.filter(Boolean).map((p: any) => p.text)
    expect(usageSections(1_000, 100).map((x: any) => x.key)).toEqual(['ctx', 'five_hour', 'trajectory'])
    expect(traj(100)).toEqual(['#1', 'update_plan', '980ms'])
    expect(traj(80)).toEqual(['updat…'])                                       // a narrow band: the tool alone, still there
    traceEnded(u, 'k1', { at: 30, isError: false })
    u.activity = { state: 'thinking', tool: null, since: 30 } as any                // between that call and the next request
    expect(traj(100)).toContain('thinking')
    u.activity = { state: 'idle', tool: null, since: 40 } as any                    // the turn is over: how many requests
    expect(traj(100)).toEqual(['1', 'request'])
    expect(traj(80)).toEqual(['1', 'req'])
  } finally {
    state.usage = saved
  }
})

