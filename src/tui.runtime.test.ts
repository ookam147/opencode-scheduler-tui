import { describe, expect, test } from "bun:test"

describe("scheduler TUI distribution", () => {
  test("uses the Solid universal transform instead of the automatic JSX runtime", async () => {
    const source = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text()
    expect(source).toContain("createComponent")
    expect(source).toContain("insert")
    expect(source).toContain("effect")
    expect(source).not.toContain("jsxDEV")
    expect(source).not.toContain("@opentui/solid/jsx-dev-runtime")
  })
})
