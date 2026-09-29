import { BOXES, BoxRules } from "../play/Board";

interface MiniBoardProps {
  /** Открытые клетки Grid ∞: индекс → цифра скрытого решения. */
  clues: ReadonlyMap<number, number>;
  /** Клетка, куда приземляется (приземлилась) клетка дня — пунктирное кольцо (макет `.target`). */
  target: number | null;
  /** Клетка дня уже на месте: кольцо становится сплошным. */
  landed: boolean;
  /** Показать M5-«толчок» приземления (кольцо 260 мс); иначе кольцо просто сплошное. */
  pulse: boolean;
  label: string;
}

/**
 * Grid ∞ на экране Today (макет `#board-infinite`): то же поле B, только статичное — открытые
 * клетки как подсказки, остальное пусто. Не интерактивно, читается скринридером как одна картинка.
 */
export function MiniBoard({ clues, target, landed, pulse, label }: MiniBoardProps) {
  return (
    <div className="board-wrap">
      <div className="board" role="img" aria-label={label} data-testid="grid-inf" data-clues={clues.size}>
        {BOXES.map((cells, b) => (
          <div className="box" key={b}>
            {cells.map((i) => {
              const digit = clues.get(i);
              const cls = ["cell"];
              if (i === target) cls.push("target");
              if (i === target && landed) cls.push("landed", pulse ? "pulse" : "still");
              return (
                <div key={i} className={cls.join(" ")} data-i={i} data-testid={i === target ? "grid-inf-target" : undefined}>
                  {digit ? (
                    <span className="d given" aria-hidden="true">
                      {digit}
                    </span>
                  ) : null}
                </div>
              );
            })}
            <BoxRules />
          </div>
        ))}
      </div>
    </div>
  );
}
