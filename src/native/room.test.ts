import { describe, expect, test } from "bun:test"
import { composerRoom, type LayoutNode } from "./room"

function node(height: number, children: LayoutNode[] = [], extra: object = {}): LayoutNode {
  const item = { parent: null as LayoutNode | null, height, getChildren: () => children, ...extra }
  for (const child of children) (child as { parent: LayoutNode | null }).parent = item
  return item
}

describe("room above the message box", () => {
  test("covers the conversation minus the other rows and the message box", () => {
    const window = node(10)
    const composer = node(6)
    const bottom = node(16, [window, composer])
    const messages = node(30, [node(30, [], { scrollChildIntoView() {} })])
    const jump = node(1)
    node(48, [messages, jump, bottom])
    // 48 - 1 padding - 1 jump row - 6 composer
    expect(composerRoom(window)).toBe(40)
  })
  test("keeps a usable minimum and is undefined outside a session column", () => {
    const window = node(10)
    const bottom = node(40, [window, node(30)])
    node(42, [node(1, [node(1, [], { scrollChildIntoView() {} })]), bottom])
    expect(composerRoom(window)).toBe(12)
    const lone = node(5)
    node(20, [lone, node(3)])
    expect(composerRoom(lone)).toBeUndefined()
  })
})
