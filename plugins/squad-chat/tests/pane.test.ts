import { test, expect } from 'claude-code/testing'

const PANE = {
  plugin: 'squad-chat',
  component: 'Pane',
  requestId: 'squad-chat',
} as const

const props = (placement: 'dock' | 'inline') => ({
  title: 'Squad Chat',
  isFocused: true,
  bodyColumns: 48,
  placement,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}) as any

test('pane draws a compose box and an empty state on every surface with Input', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const placement of ['dock', 'inline'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: props(placement) })
      expect(await ui.find({ key: 'compose' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /No messages yet/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('sending before the bridge is connected does not throw', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: props('dock') })
  await ui.input({ key: 'compose', text: 'hello' })
  expect(await ui.find({ type: 'Text', text: /No messages yet/ })).toBeDefined()
  await ui.unmount()
})
