const tuiSource = await Bun.file(new URL("../dist/native/tui.js", import.meta.url)).text()
const serverSource = await Bun.file(new URL("../dist/native/server.js", import.meta.url)).text()

for (const primitive of ["createComponent", "insert", "effect"]) {
  if (!tuiSource.includes(primitive)) {
    throw new Error(`dist/native/tui.js is missing Solid universal primitive: ${primitive}`)
  }
}

if (tuiSource.includes("jsxDEV") || tuiSource.includes("@opentui/solid/jsx-dev-runtime")) {
  throw new Error("dist/native/tui.js was compiled with the non-reactive automatic JSX runtime")
}

if (!/from\s+["']@opentui\/solid["']/.test(tuiSource) || !/from\s+["']solid-js["']/.test(tuiSource)) {
  throw new Error("dist/native/tui.js does not leave the OpenTUI and Solid runtimes external for the host loader")
}

if (serverSource.includes("@opentui/solid") || serverSource.includes("solid-js")) {
  throw new Error("dist/native/server.js unexpectedly includes the TUI renderer runtime")
}

for (const source of [tuiSource, serverSource]) {
  for (const legacy of ["launchctl", "schtasks", "supervisor.pl", "@opencode-ai/plugin"]) {
    if (source.includes(legacy)) throw new Error(`native package entry imports legacy scheduler: ${legacy}`)
  }
}
if (!tuiSource.includes("@opencode/plugin/tui")) throw new Error("native TUI must use the host V2 plugin SDK")
await Promise.all([import("../dist/native/server.js"), import("../dist/native/tui.js")])

console.log("package exports and shared TUI runtime verified")
