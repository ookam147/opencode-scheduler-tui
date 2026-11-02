import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/native/server.ts", "src/native/tui.tsx"],
  outdir: "dist",
  root: "src",
  target: "bun",
  format: "esm",
  external: [
    "@opentui/core",
    "@opentui/core/*",
    "@opentui/keymap",
    "@opentui/keymap/*",
    "@opentui/solid",
    "@opentui/solid/*",
    "solid-js",
    "solid-js/*",
    "@opencode/plugin",
    "@opencode/plugin/*",
  ],
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

for (const output of result.outputs) {
  console.log(`${output.path} ${output.size} bytes`)
}
