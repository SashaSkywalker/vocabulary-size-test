import { applyAnswer, clampProgress, createEmptyProgress, formatPercent, getAccuracy } from './progress';

describe('progress helpers', () => {
  it('creates an empty progress state', () => {
    const progress = createEmptyProgress(new Date('2026-01-01T00:00:00.000Z'));

    expect(progress).toEqual({
      currentIndex: 0,
      correctCount: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('applies answers and completes at the final question', () => {
    const progress = createEmptyProgress(new Date('2026-01-01T00:00:00.000Z'));
    const first = applyAnswer(progress, true, 2, new Date('2026-01-01T00:00:01.000Z'));
    const second = applyAnswer(first, false, 2, new Date('2026-01-01T00:00:02.000Z'));

    expect(first.currentIndex).toBe(1);
    expect(first.correctCount).toBe(1);
    expect(first.completedAt).toBeUndefined();
    expect(second.currentIndex).toBe(2);
    expect(second.correctCount).toBe(1);
    expect(second.completedAt).toBe('2026-01-01T00:00:02.000Z');
  });

  it('clamps persisted progress into the valid range', () => {
    const clamped = clampProgress(
      {
        currentIndex: 200,
        correctCount: 300,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      170
    );

    expect(clamped.currentIndex).toBe(170);
    expect(clamped.correctCount).toBe(170);
  });

  it('formats accuracy safely', () => {
    expect(getAccuracy(0, 0)).toBe(0);
    expect(formatPercent(getAccuracy(7, 10))).toBe('70.0%');
  });
});
