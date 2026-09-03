import {
  DIFFICULTIES,
  type ChartSummary,
  type DifficultyId,
} from "../game/types";

const meta: Record<DifficultyId, { label: string }> = {
  easy: { label: "EASY" },
  normal: { label: "NORMAL" },
  hard: { label: "HARD" },
};

interface DifficultySelectorProps {
  value: DifficultyId;
  disabled?: boolean;
  levels: Record<DifficultyId, number | null>;
  details?: Record<
    DifficultyId,
    (ChartSummary & { bestScore: number; description: string }) | null
  >;
  onChange: (difficulty: DifficultyId) => void;
}

export function DifficultySelector({
  value,
  disabled,
  levels,
  details,
  onChange,
}: DifficultySelectorProps) {
  const selected = details?.[value] ?? null;
  return (
    <section className="difficulty-picker" aria-label="谱面难度">
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
          </button>
        ))}
      </div>
      {selected && (
        <div className="difficulty-detail" aria-live="polite">
          <p>{selected.description}</p>
          <div>
            <span>{selected.noteCount} 音符</span>
            <span>{selected.tapCount} Tap</span>
            <span>{selected.holdCount} Hold</span>
            <span>BEST {String(selected.bestScore).padStart(7, "0")}</span>
          </div>
        </div>
      )}
    </section>
  );
}
