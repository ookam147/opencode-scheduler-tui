const tuiSource = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text()

if (!tuiSource.includes('from "opentui:runtime-module:solid-js"')) {
  throw new Error("dist/tui.js does not use the OpenTUI host Solid runtime")
}

if (/from\s+["']solid-js["']/.test(tuiSource)) {
  throw new Error("dist/tui.js still contains a bare solid-js runtime import")
}

await Promise.all([
  import("../dist/index.js"),
  import("../dist/server.js"),
  import("../dist/tui.js"),
])

console.log("package exports and shared TUI runtime verified")
