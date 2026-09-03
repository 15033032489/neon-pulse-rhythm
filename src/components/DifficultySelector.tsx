import { DIFFICULTIES, type DifficultyId } from "../game/types";

const meta: Record<DifficultyId, { label: string; hint: string }> = {
  easy: { label: "EASY", hint: "入门节奏" },
  normal: { label: "NORMAL", hint: "标准脉冲" },
  hard: { label: "HARD", hint: "高速三连" },
};

interface DifficultySelectorProps {
  value: DifficultyId;
  disabled?: boolean;
  levels: Record<DifficultyId, number | null>;
  onChange: (difficulty: DifficultyId) => void;
}

export function DifficultySelector({
  value,
  disabled,
  levels,
  onChange,
}: DifficultySelectorProps) {
  return (
    <div
      className="difficulty-selector"
      role="radiogroup"
      aria-label="选择谱面难度"
    >
      {DIFFICULTIES.map((difficulty) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === difficulty}
          className={value === difficulty ? "is-selected" : ""}
          disabled={disabled || levels[difficulty] === null}
          onClick={() => onChange(difficulty)}
          key={difficulty}
        >
          <span>{meta[difficulty].label}</span>
          <b>LV.{levels[difficulty] ?? "--"}</b>
          <small>{meta[difficulty].hint}</small>
        </button>
      ))}
    </div>
  );
}
