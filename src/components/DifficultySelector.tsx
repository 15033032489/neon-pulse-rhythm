import {
  DIFFICULTIES,
  type ChartSummary,
  type DifficultyId,
} from "../game/types";

const meta: Record<DifficultyId, { label: string; hint: string }> = {
  easy: { label: "EASY", hint: "入门节奏" },
  normal: { label: "NORMAL", hint: "标准脉冲" },
  hard: { label: "HARD", hint: "高速三连" },
};

interface DifficultySelectorProps {
  value: DifficultyId;
  disabled?: boolean;
  levels: Record<DifficultyId, number | null>;
  details?: Record<DifficultyId, (ChartSummary & { bestScore: number }) | null>;
  onChange: (difficulty: DifficultyId) => void;
}

export function DifficultySelector({
  value,
  disabled,
  levels,
  details,
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
          {details?.[difficulty] && (
            <small className="difficulty-counts">
              {details[difficulty]?.noteCount} 音符 ·{" "}
              {details[difficulty]?.tapCount} Tap /{" "}
              {details[difficulty]?.holdCount} Hold
            </small>
          )}
          {details?.[difficulty] && (
            <small className="difficulty-best">
              BEST{" "}
              {String(details[difficulty]?.bestScore ?? 0).padStart(7, "0")}
            </small>
          )}
        </button>
      ))}
    </div>
  );
}
