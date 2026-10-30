import type { ScheduleRow } from "./model.js";
/** SDK polls allocate new objects; preserve unchanged rows so Solid doesn't remount them. */
export declare function retainUnchangedRows(previous: ScheduleRow[], next: ScheduleRow[]): ScheduleRow[];
export declare function retainUnchangedWarnings(previous: string[], next: string[]): string[];
