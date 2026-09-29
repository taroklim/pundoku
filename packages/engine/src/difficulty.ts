/**
 * Сложность по двум осям: число подсказок × самая дорогая техника human-style решателя.
 *
 * Зачем вторая ось (калибровка PD-5): все дневные сетки Sudoku.com «hard» решаются одними
 * singles при 30 подсказках — одна техника-ось не отличает их от лёгких 38-подсказочных сеток,
 * а именно число подсказок делает singles-сетку заметно тяжелее.
 */
import type { Difficulty, DifficultyProfile } from "./types.js";

/** Классы по возрастанию сложности. */
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "expert", "master"];

/**
 * Профиль каждого класса: целевое число подсказок и техника.
 *
 * | класс  | подсказок | техника                                          |
 * | ------ | --------- | ------------------------------------------------ |
 * | easy   | 38        | только singles                                   |
 * | medium | 30        | только singles (≈ Sudoku.com «hard»)             |
 * | hard   | 26        | + locked candidates                              |
 * | expert | 24        | + naked/hidden pairs                             |
 * | master | 24        | решатель застрял (`beyond`), нужен X-Wing и выше |
 */
export const DIFFICULTY_PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = {
  easy: { clues: 38, technique: "hidden_single" },
  medium: { clues: 30, technique: "hidden_single" },
  hard: { clues: 26, technique: "locked_candidates" },
  expert: { clues: 24, technique: "hidden_pair" },
  master: { clues: 24, technique: "beyond" },
};

/**
 * Граница внутри singles-класса для `rateDifficulty`: сетка, решаемая одними singles, с числом
 * подсказок ≥ этого — easy, меньше — medium (середина между целями 38 и 30).
 */
export const EASY_MIN_CLUES = 34;
