import { solve } from "@pundoku/engine";
export function solveGrid(rows: number[][]) { return solve(rows.flat() as never) as unknown; }
