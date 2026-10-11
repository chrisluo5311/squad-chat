import { test, expect } from 'claude-code/testing'
import { parseLog, layoutGraph } from '../hooks/github.mjs'

// The Git room's commit graph on the desktop: `git log` records parsed, then
// laid out in lanes the way Fork draws them.
test('git log becomes commits with their branches, laid out in lanes', async () => {
  const rec = (hash: string, parents: string, refs: string, subject: string) => `${hash}\x1f${parents}\x1f${refs}\x1f${subject}\x1f1760000000\x1e\n`
  const log = parseLog(
    rec('m', 'b u', 'origin/main', 'Merge #2') +
    rec('b', 'x', 'HEAD -> band, origin/band', 'Band work') +
    rec('u', 'x', 'tag: v1', 'Usage work') +
    rec('x', '', 'origin/HEAD', 'Start'),
  )
  expect(log[1].head).toBe('band')
  expect(log[1].refs).toEqual(['band', 'origin/band'])
  expect(log[2].refs).toEqual(['v1'])
  expect(log[3].refs).toEqual([])          // origin/HEAD says nothing a branch doesn't
  const rows = layoutGraph(log)
  expect(rows.map((r: any) => r.col)).toEqual([0, 0, 1, 0])   // the merge opens a second lane, which joins again at the start
  expect(rows[0].after).toEqual(['b', 'u'])
  expect(rows[3].before).toEqual(['x', 'x'])
})
