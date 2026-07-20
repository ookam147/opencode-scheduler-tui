import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "opentui:runtime-module:solid-js"
import { createSignal as hostCreateSignal } from "solid-js"

describe("scheduler TUI Solid runtime", () => {
  test("runs reactive effects through the OpenTUI host runtime", () => {
    expect(createSignal).toBe(hostCreateSignal)
    const values: number[] = []
    let update: ((value: number) => number) | undefined
    let dispose: (() => void) | undefined

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [value, setValue] = createSignal(0)
      update = setValue
      createEffect(() => values.push(value()))
    })

    expect(values).toEqual([0])
    update?.(1)
    expect(values).toEqual([0, 1])
    dispose?.()
  })
})
