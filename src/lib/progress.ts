export interface ProgressState {
  currentIndex: number;
  correctCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function createEmptyProgress(now = new Date()): ProgressState {
  const isoNow = now.toISOString();
  return {
    currentIndex: 0,
    correctCount: 0,
    startedAt: isoNow,
    updatedAt: isoNow
  };
}

export function applyAnswer(
  progress: ProgressState,
  isCorrect: boolean,
  totalQuestions: number,
  now = new Date()
): ProgressState {
  const nextIndex = Math.min(progress.currentIndex + 1, totalQuestions);
  const isoNow = now.toISOString();

  return {
    ...progress,
    currentIndex: nextIndex,
    correctCount: progress.correctCount + (isCorrect ? 1 : 0),
    updatedAt: isoNow,
    completedAt: nextIndex >= totalQuestions ? isoNow : progress.completedAt
  };
}

export function clampProgress(progress: ProgressState, totalQuestions: number): ProgressState {
  const currentIndex = Math.min(Math.max(0, progress.currentIndex), totalQuestions);
  const correctCount = Math.min(Math.max(0, progress.correctCount), currentIndex);
  return {
    ...progress,
    currentIndex,
    correctCount
  };
}

export function getAccuracy(correctCount: number, answeredCount: number): number {
  if (answeredCount <= 0) return 0;
  return correctCount / answeredCount;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
