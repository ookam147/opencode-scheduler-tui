import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/index.ts", "src/server.ts", "src/tui.tsx"],
  outdir: "dist",
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
