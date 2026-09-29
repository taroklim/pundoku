/**
 * Детерминированный PRNG от строкового seed. Без Math.random: одна и та же строка даёт
 * одну и ту же последовательность на любой платформе (только 32-битная целочисленная
 * арифметика через Math.imul и беззнаковые сдвиги).
 *
 * Seed-строка → 4 × 32 бит через MurmurHash3-подобный финализатор с разными солями →
 * состояние xoshiro128**.
 */

function hash32(str: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: string) {
    this.s0 = hash32(seed, 0x9e3779b9);
    this.s1 = hash32(seed, 0x243f6a88);
    this.s2 = hash32(seed, 0xb7e15162);
    this.s3 = hash32(seed, 0x6a09e667);
    // xoshiro не должен стартовать из нулевого состояния.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    for (let i = 0; i < 8; i++) this.nextU32();
  }

  /** Беззнаковое 32-битное целое. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Целое в [0, n). */
  int(n: number): number {
    return this.nextU32() % n;
  }

  /** Перемешивание Фишера–Йейтса на месте. */
  shuffle<T>(arr: T[] | Uint8Array): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
  }
}
