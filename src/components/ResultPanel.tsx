import type {
  TimingSummary,
  Grade,
  Judgement,
  RunFlags,
  GameStats,
} from "../game/scoring";
import type { FinishReason, PlayMode } from "../game/session";
import type { DifficultyId } from "../game/types";

interface ResultPanelProps {
  songId: string;
  songTitle: string;
  songEnglishTitle?: string;
  difficulty: DifficultyId;
  noteCount: number;
  maxScoreUnits: number;
  reason: FinishReason;
  grade: Grade;
  score: number;
  accuracy: number;
  stats: GameStats;
  flags: RunFlags;
  timing: TimingSummary;
  newRecord: boolean;
  previousBestScore: number;
  mode: PlayMode;
  onReplay: () => void;
  onBack: () => void;
}

const formatScore = (score: number) => score.toString().padStart(7, "0");

export function ResultPanel({
  songTitle,
  songEnglishTitle,
  difficulty,
  noteCount,
  maxScoreUnits,
  reason,
  grade,
  score,
  accuracy,
  stats,
  flags,
  timing,
  newRecord,
  previousBestScore,
  mode,
  onReplay,
  onBack,
}: ResultPanelProps) {
  const maxBucket = Math.max(
    1,
    ...timing.histogram.map((bucket) => bucket.count),
  );
  const abandoned = reason === "abandoned";
  const practice = mode === "practice";
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
        <p className="result-track-name">
          <strong>{songTitle}</strong>
          {songEnglishTitle && <em>{songEnglishTitle}</em>}
          <span>
            {difficulty.toUpperCase()} · {noteCount} 音符 / {maxScoreUnits}{" "}
            计分单位
          </span>
        </p>
        <h2>
          {reason === "complete"
            ? "RUN COMPLETE"
            : reason === "failed"
              ? "SYSTEM BREAK"
              : "RUN ABANDONED"}
        </h2>
        {practice && (
          <div className="practice-result-badge">
            PRACTICE / 练习模式 · 本局不会写入正式记录
          </div>
        )}
        {!abandoned && !practice && (
          <div className="result-badges" aria-label="演奏成就">
            {reason === "complete" && <b className="badge-clear">CLEAR</b>}
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
            {!abandoned && !practice && (
              <small>
                历史差值 {score - previousBestScore >= 0 ? "+" : ""}
                {score - previousBestScore}
              </small>
            )}
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
        <div className="result-hold-summary">
          <span>
            HOLD COMPLETE <b>{stats.holdCompleted}</b>
          </span>
          <span>
            HOLD BREAK <b>{stats.holdBroken}</b>
          </span>
          <span>
            主判定合计{" "}
            <b>
              {stats.counts.perfect +
                stats.counts.great +
                stats.counts.good +
                stats.counts.miss}
              /{noteCount}
            </b>
          </span>
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
