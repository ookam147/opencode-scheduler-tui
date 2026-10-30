/** The renderable shape this measurement reads; OpenTUI's Renderable satisfies it. */
export type LayoutNode = {
  readonly parent: LayoutNode | null
  readonly height: number
  getChildren(): LayoutNode[]
}

const MIN_ROOM = 12

/**
 * Rows a box above the message box may take so that it covers the conversation but nothing else.
 *
 * Walks up to the session column: the ancestor whose first child holds the scrolling message
 * list. The room is that column's height minus its other rows (e.g. "Jump to latest") and minus
 * whatever shares the box's own branch (the message box, queued prompts). The session column
 * already excludes the sidebar, so the window gives way to it. Undefined outside a session.
 */
export function composerRoom(box: LayoutNode): number | undefined {
  let branch: LayoutNode = box
  for (let column = box.parent; column; branch = column, column = column.parent) {
    const rows = column.getChildren()
    const messages = rows[0]
    if (!messages || messages === branch) continue
    if (!messages.getChildren().some((item) => "scrollChildIntoView" in item)) continue
    const otherRows = rows.reduce((total, row) => row === branch || row === messages ? total : total + row.height, 0)
    const besideBox = branch.height - box.height
    // The column keeps a one-line bottom padding.
    return Math.max(MIN_ROOM, column.height - 1 - otherRows - besideBox)
  }
  return undefined
}
