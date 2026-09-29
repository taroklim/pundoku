import type { Queryable } from "./pool.js";
import type { DailyPuzzle, DailyPuzzleRepo, NewDailyPuzzle } from "../daily/types.js";

interface Row {
  date: string;
  mission: string;
  solution: string;
  difficulty: string;
  win_rate: string | null;
  source: "sudoku.com" | "generator";
  source_id: string | null;
  fetched_at: Date;
}

const COLUMNS = `to_char(date, 'YYYY-MM-DD') AS date, mission, solution, difficulty, win_rate, source, source_id, fetched_at`;

function toPuzzle(row: Row): DailyPuzzle {
  return {
    date: row.date,
    mission: row.mission,
    solution: row.solution,
    difficulty: row.difficulty,
    winRate: row.win_rate === null ? null : Number(row.win_rate),
    source: row.source,
    sourceId: row.source_id,
    fetchedAt: row.fetched_at,
  };
}

export class PgDailyPuzzleRepo implements DailyPuzzleRepo {
  constructor(private readonly db: Queryable) {}

  async find(date: string): Promise<DailyPuzzle | null> {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM daily_puzzles WHERE date = $1`, [date]);
    return rows[0] ? toPuzzle(rows[0]) : null;
  }

  /** Вставляет сетку, если для даты ещё нет; при гонке возвращает уже сохранённую. */
  async insertIfAbsent(p: NewDailyPuzzle): Promise<DailyPuzzle> {
    const { rows } = await this.db.query<Row>(
      `INSERT INTO daily_puzzles (date, mission, solution, difficulty, win_rate, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (date) DO NOTHING
       RETURNING ${COLUMNS}`,
      [p.date, p.mission, p.solution, p.difficulty, p.winRate, p.source, p.sourceId],
    );
    if (rows[0]) return toPuzzle(rows[0]);
    const existing = await this.find(p.date);
    if (!existing) throw new Error(`daily_puzzles: строка за ${p.date} исчезла между INSERT и SELECT`);
    return existing;
  }
}
