import { test, expect, mock } from 'claude-code/testing'

// The bridge, faked beneath the plugin: `node --version` answers, the spawned
// child prints whatever the test pushes, and control requests are recorded and
// answered from `replies`.
function fakeBridge(on: any, { node = 'v22.17.0' } = {}) {
  const lines: string[] = []
  let wake: (() => void) | null = null
  const calls: { path: string; body: any }[] = []
  const replies: Record<string, (body: any) => [number, any]> = {}

  // The harness never starts a session on its own: answer what the plugin's
  // session.start leans on, and `start($)` raises it.
  mock.clock(on)   // the bridge loop reads the time and sleeps between restarts
  on('session.start', async () => ({ cwd: '/' }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: `${node}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('process.spawn', async function* () {
    for (;;) {
      while (lines.length) yield { stream: 'stdout', text: lines.shift()! }
      await new Promise<void>((r) => { wake = r })
    }
  })
  on('http.fetch', async (_$: any, e: any) => {
    const path = new URL(e.url).pathname
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined
    calls.push({ path, body })
    const [status, data] = replies[path]?.(body) ?? [200, { ok: true }]
    return { value: { status, ok: status < 400, headers: {}, text: JSON.stringify(data) } }
  })

  return {
    calls,
    replies,
    start: ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true }),
    emit(...events: object[]) {
      for (const ev of events) lines.push(JSON.stringify(ev) + '\n')
      wake?.()
      wake = null
    },
  }
}

const PANE = { plugin: 'squad-chat', component: 'Pane', requestId: 'squad-chat' } as const
const props = (placement: 'dock' | 'inline') => ({
  title: 'Squad Chat', isFocused: true, bodyColumns: 60, placement,
  scroll: { offset: 0, bodyRows: placement === 'dock' ? 30 : 12 }, view: {},
}) as any

const settle = () => new Promise((r) => setTimeout(r, 50))
// The fake child stays alive (a pending read), and the kit waits for quiet
// after each act, so these run slower than the 5 s default allows for.
const SLOW = { timeoutMs: 20_000 }

const ME = { id: 'u-me', name: 'me', email: 'me@example.com' }
const BOB = { user_id: 'u-bob', name: 'bob' }
const LOBBY = { id: 'r-lobby', slug: 'lobby', last_read_id: 0, unread: 0 }
const msg = (id: number, user: string, body: string, extra: object = {}) => ({
  type: 'message', backfill: false,
  message: { id, room: LOBBY.id, slug: 'lobby', user_id: `u-${user}`, user, mine: user === 'me', body, at: '2026-10-07T04:15:00Z', ...extra },
})

function signedIn(bridge: ReturnType<typeof fakeBridge>) {
  bridge.emit(
    { type: 'ready', socket: '/tmp/fake.sock', pid: 1 },
    { type: 'auth', state: 'signed_in', user: ME },
    { type: 'rooms', current: LOBBY.id, rooms: [LOBBY] },
    { type: 'status', room: LOBBY.id, status: 'SUBSCRIBED' },
    { type: 'presence', room: LOBBY.id, online: [{ user_id: ME.id, name: 'me' }, BOB] },
    { type: 'friends', friends: [{ ...BOB, online: true, rooms: ['lobby'] }, { user_id: 'u-carol', name: 'carol', online: false, rooms: ['lobby'] }] },
  )
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: signs in from the pane with email, then code`, SLOW, async ($, on) => {
    const bridge = fakeBridge(on)
    await bridge.start($)
    bridge.emit({ type: 'ready', socket: '/tmp/fake.sock', pid: 1 }, { type: 'auth', state: 'signed_out', user: null })
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface, props: props('dock') })
    expect(await ui.find({ type: 'Text', text: /Sign in to chat/ })).toBeDefined()

    await ui.input({ key: 'compose', text: 'me@example.com' })
    expect(bridge.calls.at(-1)).toEqual({ path: '/login/start', body: { email: 'me@example.com' } })

    bridge.emit({ type: 'auth', state: 'code_sent', user: null, email: 'me@example.com' })
    await settle()
    expect(await ui.find({ type: 'Text', text: /Code sent to me@example.com/ })).toBeDefined()

    bridge.replies['/login/verify'] = () => [200, { ok: true, user: ME }]
    await ui.input({ key: 'compose', text: '1234 5678' })
    expect(bridge.calls.at(-1)).toEqual({ path: '/login/verify', body: { code: '12345678' } })
    await ui.unmount()
  })

  test(`${surface}: shows the room, who's online and messages; sends on Enter`, SLOW, async ($, on) => {
    const bridge = fakeBridge(on)
    await bridge.start($)
    signedIn(bridge)
    bridge.emit(msg(1, 'bob', 'hi there'), msg(2, 'me', 'hey bob'))
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface, props: props('dock') })
    expect(await ui.find({ type: 'Text', text: '#lobby' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 online · ● bob {2}○ carol/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /bob: hi there/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /me: hey bob/ })).toBeDefined()

    await ui.input({ key: 'compose', text: 'hello all' })
    expect(bridge.calls.at(-1)).toEqual({ path: '/send', body: { text: 'hello all', room: LOBBY.id } })
    await ui.unmount()
  })

  test(`${surface}: inline pane is compact`, SLOW, async ($, on) => {
    const bridge = fakeBridge(on)
    await bridge.start($)
    signedIn(bridge)
    for (let i = 1; i <= 12; i++) bridge.emit(msg(i, 'bob', `message number ${i}`))
    await settle()
    const ui = await $.ui.mount({ ...PANE, surface, props: props('inline') })
    expect(await ui.find({ type: 'Text', text: /online: bob/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /message number 12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /message number 3$/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('messages are kept in id order and drawn once', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  bridge.emit(msg(5, 'bob', 'five'), msg(3, 'bob', 'three'), msg(5, 'bob', 'five'))
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  const lines = await ui.findAll({ type: 'Text', text: /bob: (three|five)/ })
  expect(lines.map((l: any) => l.text.replace(/^\d\d:\d\d /, ''))).toEqual(['bob: three', 'bob: five'])
  await ui.unmount()
})

test('/room typed in the pane joins with the passcode, and errors show in the pane', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  bridge.replies['/room'] = () => [403, { error: 'wrong passcode' }]
  await ui.input({ key: 'compose', text: '/room secret letmein' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/room', body: { slug: 'secret', passcode: 'letmein' } })
  expect(await ui.find({ type: 'Text', text: 'wrong passcode' })).toBeDefined()
  await ui.unmount()
})

test('an old Node is reported instead of starting the bridge', SLOW, async ($, on) => {
  await fakeBridge(on, { node: 'v20.11.0' }).start($)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  expect(await ui.find({ type: 'Text', text: /needs Node 22 or newer \(found v20.11.0\)/ })).toBeDefined()
  await ui.unmount()
})
