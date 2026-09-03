export const TUTORIAL_STORAGE_KEY = "neon-pulse:tutorial:v1";
export const TUTORIAL_STEP_COUNT = 4;

export function loadTutorialCompleted(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): boolean {
  try {
    return storage.getItem(TUTORIAL_STORAGE_KEY) === "complete";
  } catch {
    return false;
  }
}

export function saveTutorialCompleted(
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(TUTORIAL_STORAGE_KEY, "complete");
  } catch {
    // The tutorial stays usable when storage is unavailable.
  }
}

export const tutorialStepAfterNext = (step: number): number | null =>
  step >= TUTORIAL_STEP_COUNT - 1 ? null : step + 1;
