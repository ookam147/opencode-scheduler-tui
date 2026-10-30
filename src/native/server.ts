import { Plugin } from "@opencode/plugin"

/** The host owns scheduling. Loading this plugin never installs an OS timer. */
export default Plugin.define({
  id: "opencode-scheduler",
  setup() {},
})
