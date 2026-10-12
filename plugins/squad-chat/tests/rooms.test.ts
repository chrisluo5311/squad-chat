import { test, expect } from 'claude-code/testing'
import { createFocus, start, adjust, progress, restoreFocus, streaks, focusTimer, tickFocus, dayOf } from '../hooks/focus.mjs'
import { createPet, petTick, petSaved, restorePet } from '../hooks/pet.mjs'
import { fitSections } from '../hooks/bands.mjs'
import { state } from '../hooks/state.mjs'

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
