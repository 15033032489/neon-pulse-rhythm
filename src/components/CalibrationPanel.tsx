import type { CalibrationResult } from "../game/calibration";

interface CalibrationPanelProps {
  open: boolean;
  running: boolean;
  tappedBeats: number;
  result: CalibrationResult | null;
  currentOffsetMs: number;
  onClose: () => void;
  onStart: () => void;
  onTap: () => void;
  onPreview: () => void;
  onApply: (offsetMs: number) => void;
}

export function CalibrationPanel({
  open,
  running,
  tappedBeats,
  result,
  currentOffsetMs,
  onClose,
  onStart,
  onTap,
  onPreview,
  onApply,
}: CalibrationPanelProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop calibration-backdrop" role="presentation">
      <section
        className="calibration-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-title"
      >
        <button
          type="button"
          className="panel-close"
          onClick={onClose}
          aria-label="关闭校准"
        >
          ×
        </button>
        <span className="overlay-index">延迟实验室 · 4 + 16</span>
        <h2 id="calibration-title">自动延迟校准</h2>
        <p>
          先跟随 4 个预热拍，再完成 16 拍采样。用
          D/F/J/K、空格或下方区域跟拍；系统会忽略异常值并采用稳健中位数。
        </p>
        <div className="offset-explanation">
          <span>
            <b>正值 +</b> 让谱面与判定相对音乐更晚
          </span>
          <span>
            <b>负值 −</b> 让谱面与判定相对音乐更早
          </span>
        </div>
        <div className="calibration-current">
          当前偏移{" "}
          <b>
            {currentOffsetMs >= 0 ? "+" : ""}
            {currentOffsetMs} ms
          </b>
        </div>

        <button
          type="button"
          className={`calibration-pad ${running ? "is-running" : ""}`}
          onPointerDown={(event) => {
            event.preventDefault();
            onTap();
          }}
          disabled={!running}
          aria-label="跟随节拍点击"
        >
          <i aria-hidden="true" />
          <strong>{running ? "TAP THE PULSE" : "CALIBRATION READY"}</strong>
          <span>
            {running
              ? `有效样本 ${tappedBeats} / 16 · 前 4 拍为预热`
              : "4 个预热拍 + 16 个有效采样"}
          </span>
        </button>

        {result && (
          <div
            className={`calibration-result ${result.ok ? "is-success" : "is-error"}`}
            role="status"
          >
            <strong>{result.message}</strong>
            <span>
              有效 {result.acceptedSamples.length} · 异常/忽略{" "}
              {result.ignoredCount} · 中位偏差{" "}
              {result.medianDeviationMs >= 0 ? "+" : ""}
              {result.medianDeviationMs.toFixed(1)} ms · 推荐{" "}
              {result.recommendedOffsetMs >= 0 ? "+" : ""}
              {result.recommendedOffsetMs} ms
            </span>
          </div>
        )}

        <div className="calibration-actions">
          <button type="button" onClick={onPreview} disabled={running}>
            试听 4 拍
          </button>
          <button
            type="button"
            className="deck-primary calibration-start"
            onClick={onStart}
            disabled={running}
          >
            {result ? "重新校准" : "开始校准"}
          </button>
          {result?.ok && (
            <button
              type="button"
              className="apply-offset"
              onClick={() => onApply(result.recommendedOffsetMs)}
            >
              应用 {result.recommendedOffsetMs >= 0 ? "+" : ""}
              {result.recommendedOffsetMs} ms
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
