import type {
  TimingSummary,
  Grade,
  Judgement,
  RunFlags,
  GameStats,
} from "../game/scoring";
import type { FinishReason } from "../game/session";

interface ResultPanelProps {
  reason: FinishReason;
  grade: Grade;
  score: number;
  accuracy: number;
  stats: GameStats;
  flags: RunFlags;
  timing: TimingSummary;
  newRecord: boolean;
  onReplay: () => void;
  onBack: () => void;
}

const formatScore = (score: number) => score.toString().padStart(7, "0");

export function ResultPanel({
  reason,
  grade,
  score,
  accuracy,
  stats,
  flags,
  timing,
  newRecord,
  onReplay,
  onBack,
}: ResultPanelProps) {
  const maxBucket = Math.max(
    1,
    ...timing.histogram.map((bucket) => bucket.count),
  );
  const abandoned = reason === "abandoned";
  return (
    <div className="game-overlay result-overlay result-overlay-upgraded">
      <div className={`grade grade-${grade}`}>
        {abandoned ? "—" : grade}
        <span>{abandoned ? "NO SAVE" : "RANK"}</span>
      </div>
      <div className="result-copy">
        <span className="overlay-index">
          {reason === "complete"
            ? "// TRACK COMPLETE"
            : reason === "failed"
              ? "// SIGNAL LOST"
              : "// SESSION ABANDONED"}
        </span>
        <h2>
          {reason === "complete"
            ? "RUN COMPLETE"
            : reason === "failed"
              ? "SYSTEM BREAK"
              : "RUN ABANDONED"}
        </h2>
        {!abandoned && (
          <div className="result-badges" aria-label="演奏成就">
            {flags.ap && <b className="badge-ap">AP · ALL PERFECT</b>}
            {!flags.ap && flags.fc && (
              <b className="badge-fc">FC · FULL COMBO</b>
            )}
            {newRecord && <b className="badge-record">NEW RECORD</b>}
          </div>
        )}
        {abandoned && (
          <p className="abandon-note">本局未保存，剩余音符没有计入 Miss。</p>
        )}
        <div className="result-highlights">
          <span>
            SCORE<b>{formatScore(score)}</b>
          </span>
          <span>
            ACCURACY<b>{accuracy.toFixed(2)}%</b>
          </span>
          <span>
            MAX COMBO<b>{stats.maxCombo}</b>
          </span>
        </div>
        <div className="result-counts">
          {(["perfect", "great", "good", "miss"] as Judgement[]).map(
            (judgement) => (
              <span key={judgement} className={`result-${judgement}`}>
                {judgement.toUpperCase()} <b>{stats.counts[judgement]}</b>
              </span>
            ),
          )}
        </div>
        <div className="timing-summary">
          <span>
            EARLY <b>{timing.early}</b>
          </span>
          <span>
            LATE <b>{timing.late}</b>
          </span>
          <span>
            平均偏差{" "}
            <b>
              {timing.averageSignedMs >= 0 ? "+" : ""}
              {timing.averageSignedMs.toFixed(1)}ms
            </b>
          </span>
          <span>
            平均绝对偏差 <b>{timing.averageAbsoluteMs.toFixed(1)}ms</b>
          </span>
        </div>
        <div className="timing-histogram" aria-label="判定时间分布图">
          {timing.histogram.map((bucket) => (
            <div key={bucket.label}>
              <i
                style={{
                  height: `${Math.max(4, (bucket.count / maxBucket) * 100)}%`,
                }}
              />
              <b>{bucket.count}</b>
              <span>{bucket.label}</span>
            </div>
          ))}
        </div>
        <div className="result-actions">
          <button
            type="button"
            className="start-button compact"
            onClick={onReplay}
          >
            <span>PLAY AGAIN</span>
            <i>↻</i>
          </button>
          <button type="button" onClick={onBack}>
            返回选曲
          </button>
        </div>
      </div>
    </div>
  );
}
