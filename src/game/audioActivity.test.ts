import { describe, expect, it, vi } from "vitest";
import { AudioActivityController } from "./audioActivity";

describe("试听、教程与校准音频互斥", () => {
  it("切换活动时立即清理前一个活动", () => {
    const controller = new AudioActivityController();
    const stopPreview = vi.fn();
    const stopTutorial = vi.fn();
    controller.start("preview", stopPreview);
    controller.start("tutorial", stopTutorial);
    expect(stopPreview).toHaveBeenCalledOnce();
    expect(controller.current()).toBe("tutorial");
    controller.stop();
    expect(stopTutorial).toHaveBeenCalledOnce();
    expect(controller.current()).toBeNull();
  });

  it("不让错误模式取消当前活动且清理只执行一次", () => {
    const controller = new AudioActivityController();
    const cleanup = vi.fn();
    controller.start("calibration", cleanup);
    expect(controller.stop("preview")).toBe(false);
    expect(controller.stop("calibration")).toBe(true);
    expect(controller.stop("calibration")).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("快速连续启动两个试听时先清理旧试听且不会叠加", () => {
    const controller = new AudioActivityController();
    const first = vi.fn();
    const second = vi.fn();
    controller.start("preview", first);
    controller.start("preview", second);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(controller.current()).toBe("preview");
    controller.stop("preview");
    expect(second).toHaveBeenCalledOnce();
  });
});
