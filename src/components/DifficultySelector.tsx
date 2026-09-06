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
    | (ChartSummary & {
        bestScore: number;
        description: string;
        features: string[];
      })
    | null
  >;
  drafts?: Record<
    DifficultyId,
    { status: "draft"; description: string } | null
  >;
  onChange: (difficulty: DifficultyId) => void;
}

export function DifficultySelector({
  value,
  disabled,
  levels,
  details,
  drafts,
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
            disabled={disabled}
            onClick={() => onChange(difficulty)}
            key={difficulty}
          >
            <span>{meta[difficulty].label}</span>
            <b>
              {levels[difficulty] === null
                ? drafts?.[difficulty]
                  ? "待制谱"
                  : "LV.--"
                : `LV.${levels[difficulty]}`}
            </b>
            {details?.[difficulty] && (
              <small>
                {details[difficulty]?.features.slice(0, 2).join(" · ")}
              </small>
            )}
          </button>
        ))}
      </div>
      {selected && (
        <div className="difficulty-detail" aria-live="polite">
          <p>{selected.description}</p>
          <div className="difficulty-features" aria-label="谱面特征">
            {selected.features.map((feature) => (
              <b key={feature}>{feature}</b>
            ))}
          </div>
          <div>
            <span>{selected.noteCount} 音符</span>
            <span>{selected.tapCount} Tap</span>
            <span>{selected.holdCount} Hold</span>
            <span>BEST {String(selected.bestScore).padStart(7, "0")}</span>
          </div>
          <dl className="chart-metrics">
            <div>
              <dt>平均 NPS</dt>
              <dd>{selected.averageNps.toFixed(2)}</dd>
            </div>
            <div>
              <dt>峰值 NPS</dt>
              <dd>{selected.peakNps}</dd>
            </div>
            <div>
              <dt>双押比例</dt>
              <dd>{Math.round(selected.chordRatio * 100)}%</dd>
            </div>
            <div>
              <dt>最长换手</dt>
              <dd>{selected.longestAlternation}</dd>
            </div>
            <div>
              <dt>同轨连点</dt>
              <dd>{selected.maxSameLaneRun}</dd>
            </div>
            <div>
              <dt>Hold 中处理</dt>
              <dd>{selected.notesDuringHolds}</dd>
            </div>
          </dl>
        </div>
      )}
      {!selected && drafts?.[value] && (
        <div className="difficulty-detail is-draft" aria-live="polite">
          <p>{drafts[value]?.description}</p>
          <div className="difficulty-features" aria-label="谱面状态">
            <b>制作模板</b>
            <b>等待匹配音频</b>
          </div>
          <div>
            <span>音符未生成</span>
            <span>不会计入 18 套正式谱面</span>
          </div>
        </div>
      )}
    </section>
  );
}
