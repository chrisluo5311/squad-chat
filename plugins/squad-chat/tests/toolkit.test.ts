import { test, expect } from 'claude-code/testing'
import { runTool, findTool, detectClip, md5, parseCron, cronNext, describeCron, TOOL_IDS } from '../hooks/toolkit.mjs'

// The Toolbox room's tools, run as the room runs them: on what's typed, at a
// moment. Each answers with rows (a label, the text, what ⧉ copies).
const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime()
const texts = (out: any) => out.rows.map((r: any) => (r.label ? `${r.label}: ${r.text}` : r.text))
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

test('sixteen tools, found by id, label or a short name', () => {
  expect(TOOL_IDS.length).toBe(16)
  expect(findTool('UUID')).toBe('uuid')
  expect(findTool('b64')).toBe('base64')
  expect(findTool('pw')).toBe('password')
  expect(findTool('ts')).toBe('time')
  expect(findTool('hello')).toBe(null)
})

test('Base64, URL, HTML and escapes: both ways, the reading first when there is one', async () => {
  expect(texts(await runTool('base64', 'aGVsbG8gd29ybGQ=', NOW))).toEqual(['decoded: hello world', 'encoded: YUdWc2JHOGdkMjl5YkdRPQ==', 'url-safe: YUdWc2JHOGdkMjl5YkdRPQ'])
  expect(texts(await runTool('base64', '中文', NOW))).toEqual(['encoded: 5Lit5paH', 'url-safe: 5Lit5paH'])
  const url = await runTool('url', 'https://x.com/s?q=a%20b&lang=zh-TW', NOW)
  expect(texts(url)).toContain('decoded: https://x.com/s?q=a b&lang=zh-TW')
  expect(texts(url)).toContain('?lang: zh-TW')
  expect(texts(await runTool('html', '&lt;b&gt; &#x4e2d;', NOW))[0]).toBe('unescaped: <b> 中')
  expect(texts(await runTool('escape', 'a\\nb\\u00e9', NOW))[0]).toBe('unescaped: a\nbé')
  expect((await runTool('base64', '', NOW)).note).toMatch(/^Type or paste/)
})

test('JWT: the header, each claim, the times read, and how long it has; the signature is not checked', async () => {
  const exp = Math.floor(NOW / 1000) + 42 * 60
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', role: 'authenticated', exp })}.sig`
  const out = await runTool('jwt', `Bearer ${jwt}`, NOW)
  expect(out.rows[0]).toMatchObject({ label: 'header', text: '{"alg":"HS256","typ":"JWT"}' })
  expect(out.rows.find((r: any) => r.label === 'exp')).toMatchObject({ text: `${exp}  2026-10-14 10:42:00`, copy: String(exp) })
  expect(out.status).toEqual({ text: 'valid for 42m · signature not checked', tone: 'ok' })
  expect(JSON.parse(out.rows.at(-1).copy)).toEqual({ sub: 'u1', role: 'authenticated', exp })
  expect((await runTool('jwt', jwt, NOW + 3 * 3600_000)).status.text).toMatch(/^expired 2h/)
  expect((await runTool('jwt', 'not.a.jwt', NOW)).error).toMatch(/^Not a JWT/)
})

test('generators: UUIDs v4 and v7, ULIDs, passwords from each set, lorem', async () => {
  const v4 = await runTool('uuid', '', NOW)
  expect(v4.rows).toHaveLength(5)
  expect(v4.rows[0].text).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(v4.copyAll.split('\n')).toHaveLength(5)
  const v7 = await runTool('uuid', '2 v7 upper', NOW)
  expect(v7.mode).toBe('v7 ×2')
  expect(v7.rows[0].text).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-7[0-9A-F]{3}-[89AB]/)
  const ids = await runTool('ulid', '3', NOW)
  expect(ids.rows.map((r: any) => r.text)).toHaveLength(3)
  const back = await runTool('ulid', ids.rows[0].text, NOW)
  expect(back.rows.find((r: any) => r.label === 'unix ms').text).toBe(String(NOW))
  const pw = await runTool('password', '24', NOW)
  expect(pw.rows[0]).toMatchObject({ secret: true })
  expect(pw.rows[0].text).toHaveLength(24)
  expect(pw.rows[0].text).toMatch(/[A-Z]/)
  expect(pw.rows[0].text).toMatch(/[a-z]/)
  expect(pw.rows[0].text).toMatch(/[0-9]/)
  expect(pw.strength).toBe('strong')
  expect((await runTool('password', '6 digits', NOW)).rows[0].text).toMatch(/^\d{6}$/)
  expect((await runTool('lorem', '1', NOW)).rows[0].text).toBe('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
})

test('hashes: MD5 written out, SHA from the platform', async () => {
  expect(md5(new TextEncoder().encode(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
  expect(texts(await runTool('hash', 'hello', NOW))).toEqual([
    'md5: 5d41402abc4b2a76b9719d911017c592',
    'sha1: aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    'sha256: 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    'sha512: 9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043',
  ])
})

test('time, number bases, JSON, counting and case', async () => {
  const t = await runTool('time', '1739000000', NOW)
  expect(t.rows.map((r: any) => r.label)).toEqual(['unix', 'ms', 'local', 'iso'])
  expect(t.rows[3].text).toBe('2025-02-08T07:33:20.000Z')
  expect(t.note).toBe('1 year, 8 months ago')
  expect((await runTool('time', '1739000000000', NOW)).rows[0].text).toBe('1739000000')
  expect((await runTool('time', 'soon', NOW)).error).toMatch(/^Can't read soon/)
  expect(texts(await runTool('base', '0xff', NOW))).toEqual(['dec: 255', 'hex: FF', 'oct: 377', 'bin: 1111 1111'])
  expect((await runTool('base', '12abc', NOW)).error).toMatch(/isn't a number/)
  const json = await runTool('json', '{"a":[1,2]}', NOW)
  expect(json.rows[0].text).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
  expect(json.note).toBe('an object with 1 key')
  expect((await runTool('json', '{a:1}', NOW)).error).toMatch(/^Not JSON/)
  expect(texts(await runTool('count', 'Hello world 你好\nok', NOW))).toEqual(['chars: 17', 'words: 5', 'lines: 2', 'bytes: 21 in UTF-8'])
  expect(texts(await runTool('case', 'userId fetch_URL', NOW)).slice(0, 5)).toEqual(['camel: userIdFetchUrl', 'pascal: UserIdFetchUrl', 'snake: user_id_fetch_url', 'kebab: user-id-fetch-url', 'constant: USER_ID_FETCH_URL'])
})

test('cron: read aloud, and the next times it runs', () => {
  const read = (line: string) => describeCron(parseCron(line))
  expect(read('*/15 9-18 * * 1-5')).toBe('Every 15 minutes, between 09:00 and 18:59, Monday to Friday')
  expect(read('0 9 * * *')).toBe('At 09:00, every day')
  expect(read('30 2 1 * *')).toBe('At 02:30, on day 1 of the month')
  expect(read('@weekly')).toBe('At 00:00, on Sunday')
  expect(read('0 0 1 jan,jul *')).toBe('At 00:00, on day 1 of the month, in Jan and Jul')
  const next = cronNext(parseCron('*/15 9-18 * * 1-5'), NOW, 3).map((ms: number) => new Date(ms).toTimeString().slice(0, 5))
  expect(next).toEqual(['10:15', '10:30', '10:45'])
  expect(cronNext(parseCron('0 0 30 2 *'), NOW, 1)).toEqual([])        // never: February has no 30th
  expect(() => parseCron('* * *')).toThrow(/5 fields/)
  expect(() => parseCron('61 * * * *')).toThrow(/outside 0-59/)
})

test('the clipboard at a glance: a JWT and how long it has, or a Unix time; nothing else', () => {
  const jwt = `${b64url({ alg: 'RS256' })}.${b64url({ role: 'service_role', exp: Math.floor(NOW / 1000) - 3 * 3600 })}.x`
  expect(detectClip(jwt, NOW)).toMatchObject({ kind: 'JWT', alg: 'RS256', role: 'service_role', state: { text: 'expired 3h ago', tone: 'bad' } })
  expect(detectClip('1739000000', NOW)).toMatchObject({ kind: 'ts', ms: 1739000000000 })
  expect(detectClip('9999999999999', NOW)).toBe(null)                 // past 2100: a number, not a time
  expect(detectClip('git status', NOW)).toBe(null)
})
