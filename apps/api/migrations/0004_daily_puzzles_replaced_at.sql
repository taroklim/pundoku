-- 0004_daily_puzzles_replaced_at: замена фолбэк-сетки настоящей сеткой Sudoku.com (PD-8 i).
-- Строка с source = 'generator' при следующем запросе на дату перезапрашивает Sudoku.com; если тот
-- ответил, сетка заменяется, source становится 'sudoku.com', а replaced_at фиксирует момент замены
-- (NULL = сетка ни разу не заменялась). fetched_at при замене обновляется.
ALTER TABLE daily_puzzles ADD COLUMN replaced_at TIMESTAMPTZ;
