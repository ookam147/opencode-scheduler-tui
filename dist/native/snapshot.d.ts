import type { AutomationRow } from "./model.js";
/** SDK polls allocate new objects; preserve unchanged rows so Solid doesn't remount them. */
export declare function retainUnchangedRows(previous: AutomationRow[], next: AutomationRow[]): AutomationRow[];
