/** The renderable shape this measurement reads; OpenTUI's Renderable satisfies it. */
export type LayoutNode = {
    readonly parent: LayoutNode | null;
    readonly height: number;
    getChildren(): LayoutNode[];
};
/**
 * Rows a box above the message box may take so that it covers the conversation but nothing else.
 *
 * Walks up to the session column: the ancestor whose first child holds the scrolling message
 * list. The room is that column's height minus its other rows (e.g. "Jump to latest") and minus
 * whatever shares the box's own branch (the message box, queued prompts). The session column
 * already excludes the sidebar, so the window gives way to it. Undefined outside a session.
 */
export declare function composerRoom(box: LayoutNode): number | undefined;
