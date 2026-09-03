import { useEffect, useRef } from "react";
import { bindingLabel, type LaneBindings } from "../game/settings";
import { TUTORIAL_STEP_COUNT } from "../game/tutorial";
import type { Lane } from "../game/types";

const STEPS = [
  {
    title: "认识四条轨道",
    body: "键盘使用四个绑定键；鼠标或触屏可以直接按住轨道。试着触发任意一轨。",
    cue: "PRESS ANY LANE",
  },
  {
    title: "让音符落在判定线",
    body: "音符头部与发光判定线重合时按下。现在跟着短节拍按任意轨道。",
    cue: "HIT ON THE LINE",
  },
  {
    title: "完成 Hold",
    body: "Hold 头部到线时按下，保持至少半秒，再在尾部通过后松开。",
    cue: "PRESS · HOLD · RELEASE",
  },
  {
    title: "读懂时机",
    body: "Early 表示偏早，Late 表示偏晚。音符速度只影响视觉密度；延迟校准修正判定时机。",
    cue: "READY FOR THE PULSE",
  },
] as const;

interface TutorialPanelProps {
  open: boolean;
  step: number;
  actionComplete: boolean;
  bindings: LaneBindings;
  beatPlaying: boolean;
  onLanePress: (lane: Lane) => void;
  onLaneRelease: (lane: Lane) => void;
  onPlayBeat: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function TutorialPanel({
  open,
  step,
  actionComplete,
  bindings,
  beatPlaying,
  onLanePress,
  onLaneRelease,
  onPlayBeat,
  onNext,
  onSkip,
}: TutorialPanelProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  if (!open) return null;
  const content = STEPS[step] ?? STEPS[0];
  const needsAction = step < 3;

  return (
    <div className="dialog-backdrop tutorial-backdrop" role="presentation">
      <section
        className="tutorial-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
      >
        <div className="tutorial-progress" aria-label="教程进度">
          {STEPS.map((_, index) => (
            <i className={index <= step ? "is-active" : ""} key={index} />
          ))}
        </div>
        <span className="overlay-index">
          新手教程 · {step + 1} / {TUTORIAL_STEP_COUNT}
        </span>
        <h2 id="tutorial-title" ref={headingRef} tabIndex={-1}>
          {content.title}
        </h2>
        <p>{content.body}</p>

        <div className={`tutorial-demo tutorial-step-${step}`}>
          <div className="tutorial-note" aria-hidden="true">
            {step === 2 ? "▰" : "◆"}
          </div>
          <div className="tutorial-line" aria-hidden="true">
            SYNC
          </div>
          <strong>{actionComplete ? "完成" : content.cue}</strong>
        </div>

        {step < 3 && (
          <div className="tutorial-lanes" aria-label="教程轨道">
            {bindings.map((code, index) => {
              const lane = index as Lane;
              return (
                <button
                  type="button"
                  key={lane}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    onLanePress(lane);
                  }}
                  onPointerUp={() => onLaneRelease(lane)}
                  onPointerCancel={() => onLaneRelease(lane)}
                  onLostPointerCapture={() => onLaneRelease(lane)}
                  onKeyDown={(event) => {
                    if (
                      event.repeat ||
                      (event.key !== " " && event.key !== "Enter")
                    )
                      return;
                    event.preventDefault();
                    onLanePress(lane);
                  }}
                  onKeyUp={(event) => {
                    if (event.key !== " " && event.key !== "Enter") return;
                    event.preventDefault();
                    onLaneRelease(lane);
                  }}
                  aria-label={`教程第 ${lane + 1} 轨，${bindingLabel(code)} 键`}
                >
                  <kbd>{bindingLabel(code)}</kbd>
                  <span>轨道 {lane + 1}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="tutorial-actions">
          <button type="button" onClick={onPlayBeat} disabled={beatPlaying}>
            {beatPlaying ? "节拍播放中…" : "试听教学节拍"}
          </button>
          <button
            type="button"
            className="deck-primary"
            onClick={onNext}
            disabled={needsAction && !actionComplete}
          >
            <span>{step === 3 ? "完成教程" : "下一步"}</span>
            <b>→</b>
          </button>
          <button type="button" className="tutorial-skip" onClick={onSkip}>
            跳过教程
          </button>
        </div>
        <small>按 Esc 可安全退出并停止教学音频</small>
      </section>
    </div>
  );
}
