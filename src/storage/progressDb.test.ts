import { clearProgress, loadProgress, resetProgressDbConnection, saveProgress } from './progressDb';
import type { ProgressState } from '../lib/progress';

describe('progressDb', () => {
  beforeEach(async () => {
    const fakeIndexedDb = await import('fake-indexeddb');
    vi.stubGlobal('indexedDB', fakeIndexedDb.indexedDB);
    resetProgressDbConnection();
    await deleteDatabase('lexicon-marathon');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetProgressDbConnection();
  });

  it('saves, loads, and clears progress', async () => {
    const progress: ProgressState = {
      currentIndex: 42,
      correctCount: 30,
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z'
    };

    await expect(loadProgress()).resolves.toBeUndefined();
    await saveProgress(progress);
    await expect(loadProgress()).resolves.toEqual(progress);
    await clearProgress();
    await expect(loadProgress()).resolves.toBeUndefined();
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Could not delete ${name}; request blocked.`));
  });
}
