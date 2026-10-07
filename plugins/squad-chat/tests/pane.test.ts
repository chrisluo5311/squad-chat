import { test, expect, mock } from 'claude-code/testing'

// The bridge, faked beneath the plugin: `node --version` answers, the spawned
// child prints whatever the test pushes, and control requests are recorded and
// answered from `replies`.
function fakeBridge(on: any, { node = 'v22.17.0', store = {} as Record<string, unknown> } = {}) {
  const lines: string[] = []
  let wake: (() => void) | null = null
  const calls: { path: string; body: any }[] = []
  const spawned: any[] = []
  const replies: Record<string, (body: any) => [number, any]> = {}

  // The harness never starts a session on its own: answer what the plugin's
  // session.start leans on, and `start($)` raises it.
  mock.clock(on)   // the bridge loop reads the time and sleeps between restarts
  mock.store(on, store)
  on('session.start', async () => ({ cwd: '/' }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: `${node}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('process.spawn', async function* (_$: any, e: any) {
    spawned.push(e)
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
    spawned,
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
// A message the bridge counted as news, and the room's unread count after it.
const news = (unread: number, m: object) => ({ ...m, counted: true, unread })
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
    expect(await ui.find({ type: 'Text', text: 'SIGN IN' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'step 1 of 2' })).toBeDefined()

    await ui.input({ key: 'compose', text: 'me@example.com' })
    expect(bridge.calls.at(-1)).toEqual({ path: '/login/start', body: { email: 'me@example.com' } })

    bridge.emit({ type: 'auth', state: 'code_sent', user: null, email: 'me@example.com' })
    await settle()
    expect(await ui.find({ type: 'Text', text: /Code sent to me@example.com/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'step 2 of 2' })).toBeDefined()

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
    expect(await ui.find({ type: 'Text', text: ' #lobby ' })).toBeDefined()            // the active tab
    expect(await ui.find({ type: 'Text', text: '1/2 online' })).toBeDefined()          // FRIENDS card meta
    expect(await ui.find({ type: 'Text', text: '1 here' })).toBeDefined()              // room card meta
    expect(await ui.find({ type: 'Text', text: /^bob$/ })).toBeDefined()               // a group header
    expect(await ui.find({ type: 'Text', text: 'hi there' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^you$/ })).toBeDefined()              // own messages say "you"
    expect(await ui.find({ type: 'Text', text: 'hey bob' })).toBeDefined()

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
    expect(await ui.find({ type: 'Text', text: '● bob' })).toBeDefined()
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
  const lines = await ui.findAll({ type: 'Text', text: /^(three|five)$/ })
  expect(lines.map((l: any) => l.text)).toEqual(['three', 'five'])
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

const BAND = { plugin: 'squad-chat', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } as any

// What the plugin shows outside its pane, recorded beneath it.
function recordUi(on: any, { panes = [] as any[] } = {}) {
  const seen = { statuses: [] as (string | undefined)[], toasts: [] as string[], opened: [] as string[] }
  on('ui.status', (_$: any, e: any) => { seen.statuses.push(e && typeof e === 'object' ? e.text : e); return { value: undefined } })
  on('ui.toast', (_$: any, e: any) => { seen.toasts.push(e.text ?? e); return { value: undefined } })
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$: any, e: any) => { seen.opened.push(e.id); return { value: { isPlaced: true } } })
  // The engine's own band, for when the plugin passes: nothing.
  on('ui.render', { component: 'AbovePrompt' }, (t$: any, e: any) => t$.ui.resolve(e).Box({ children: [] }))
  return seen
}

test('band: shows the room above the prompt while the pane is not up, and opens it', SLOW, async ($, on) => {
  const seen = recordUi(on)
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  bridge.emit(news(1, msg(1, 'bob', 'are you around?')))
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps })
  expect(await ui.find({ type: 'Text', text: '◆ #lobby' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 1 new ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'are you around?' })).toBeDefined()
  await ui.press({ key: 'open' })
  expect(seen.opened).toEqual(['squad-chat'])
  await ui.unmount()
})

test('band: stays out of the way while the pane is shown', SLOW, async ($, on) => {
  recordUi(on, { panes: [{ id: 'squad-chat', title: 'Squad Chat', isShown: true, isFocused: false, isPlaced: true }] })
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps })
  expect(await ui.find({ type: 'Text', text: /◆/ })).toBeUndefined()
  await ui.unmount()
})

test('unread shows on the status line and clears when the pane is focused', SLOW, async ($, on) => {
  const seen = recordUi(on)
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  bridge.emit(news(1, msg(7, 'bob', 'one')), news(2, msg(8, 'bob', 'two')))
  await settle()
  expect(seen.statuses.at(-1)).toBe('💬 #lobby 2')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })   // isFocused: true
  await settle()
  expect(bridge.calls.find((c) => c.path === '/read')).toEqual({ path: '/read', body: { room: LOBBY.id, last_id: 8 } })
  expect(seen.statuses.at(-1)).toBeUndefined()
  await ui.unmount()
})

test('an @mention toasts only with /chat notify on', SLOW, async ($, on) => {
  const seen = recordUi(on)
  const bridge = fakeBridge(on, { store: { notify: true } })
  await bridge.start($)
  signedIn(bridge)
  bridge.emit(news(1, msg(9, 'bob', 'hey @me, lunch?')), news(2, msg(10, 'bob', 'and @meg too')))
  await settle()
  expect(seen.toasts).toEqual(['💬 bob in #lobby: hey @me, lunch?'])
})

test('a "new" line marks where you had read up to, under a date label', SLOW, async ($, on) => {
  recordUi(on)
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  bridge.emit({ type: 'rooms', current: LOBBY.id, rooms: [{ ...LOBBY, last_read_id: 1, unread: 1 }] })
  bridge.emit(msg(1, 'bob', 'old news'), news(1, msg(2, 'bob', 'fresh news', { at: new Date().toISOString() })))
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })   // focused: marks read
  await settle()
  expect(bridge.calls.find((c) => c.path === '/read')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'new ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Today/ })).toBeDefined()
  await ui.unmount()
})

test('room tabs switch rooms when pressed', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  const SIDE = { id: 'r-side', slug: 'side', last_read_id: 0, unread: 2 }
  bridge.emit({ type: 'rooms', current: LOBBY.id, rooms: [LOBBY, SIDE] })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  expect(await ui.find({ type: 'Text', text: '2' })).toBeDefined()   // unread badge on the #side tab
  await ui.press({ key: 'tab-r-side' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/room/select', body: { room: 'r-side' } })
  await ui.unmount()
})

test('/room delete asks for a second run before deleting; /room leave leaves', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  await ui.input({ key: 'compose', text: '/room delete lobby' })
  expect(bridge.calls.some((c) => c.path === '/room/delete')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /again within 30 seconds to confirm/ })).toBeDefined()
  bridge.replies['/room/delete'] = () => [200, { slug: 'lobby' }]
  await ui.input({ key: 'compose', text: '/room delete lobby' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/room/delete', body: { room: LOBBY.id } })

  await ui.input({ key: 'compose', text: '/room leave lobby' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/room/leave', body: { room: LOBBY.id } })
  await ui.unmount()
})

test('signs in with just a name where the server allows it', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  bridge.emit({ type: 'ready', socket: '/tmp/fake.sock', pid: 1 }, { type: 'auth', state: 'signed_out', user: null })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  bridge.replies['/login/name'] = () => [200, { ok: true, user: { ...ME, name: 'night_owl', anonymous: true } }]
  await ui.input({ key: 'compose', text: 'night_owl' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/login/name', body: { name: 'night_owl' } })
  await ui.unmount()
})

test('signing out an account without an email asks twice', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  signedIn(bridge)
  bridge.emit({ type: 'auth', state: 'signed_in', user: { ...ME, anonymous: true } })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  await ui.input({ key: 'compose', text: '/logout' })
  expect(bridge.calls.some((c) => c.path === '/logout')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /loses "me" and your rooms for good/ })).toBeDefined()
  await ui.input({ key: 'compose', text: '/logout' })
  expect(bridge.calls.at(-1)).toEqual({ path: '/logout', body: {} })
  await ui.unmount()
})

test('without a server it says how to connect one, and stops retrying', SLOW, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  bridge.emit({ type: 'error', code: 'unconfigured', message: 'no server configured' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  expect(await ui.find({ type: 'Text', text: 'CONNECT A SERVER' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude plugin configure squad-chat@squad-chat/ })).toBeDefined()
  expect(await ui.find({ key: 'compose' })).toBeUndefined()
  await ui.unmount()
})

test('the server from the plugin options reaches the bridge', { ...SLOW, options: { supabase_url: 'https://abcd.supabase.co', supabase_key: 'sb_publishable_x' } }, async ($, on) => {
  const bridge = fakeBridge(on)
  await bridge.start($)
  await settle()
  expect(bridge.spawned[0].env).toEqual(expect.objectContaining({
    SQUAD_SUPABASE_URL: 'https://abcd.supabase.co', SQUAD_SUPABASE_KEY: 'sb_publishable_x',
  }))
})
