const tuiSource = await Bun.file(new URL("../dist/tui.js", import.meta.url)).text()
const indexSource = await Bun.file(new URL("../dist/index.js", import.meta.url)).text()
const serverSource = await Bun.file(new URL("../dist/server.js", import.meta.url)).text()

for (const primitive of ["createComponent", "insert", "effect"]) {
  if (!tuiSource.includes(primitive)) {
    throw new Error(`dist/tui.js is missing Solid universal primitive: ${primitive}`)
  }
}

if (tuiSource.includes("jsxDEV") || tuiSource.includes("@opentui/solid/jsx-dev-runtime")) {
  throw new Error("dist/tui.js was compiled with the non-reactive automatic JSX runtime")
}

if (!/from\s+["']@opentui\/solid["']/.test(tuiSource) || !/from\s+["']solid-js["']/.test(tuiSource)) {
  throw new Error("dist/tui.js does not leave the OpenTUI and Solid runtimes external for the host loader")
}

for (const [name, source] of [["index", indexSource], ["server", serverSource]] as const) {
  if (source.includes("@opentui/solid") || source.includes("solid-js")) {
    throw new Error(`dist/${name}.js unexpectedly includes the TUI renderer runtime`)
  }
}

await Promise.all([
  import("../dist/index.js"),
  import("../dist/server.js"),
  import("../dist/tui.js"),
])

console.log("package exports and shared TUI runtime verified")
