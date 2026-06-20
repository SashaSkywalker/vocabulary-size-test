import { expect, test, type Page } from '@playwright/test';

test('starts, answers, reloads, and continues', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vocabulary size test' })).toBeVisible();

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Question 1 / 170,000')).toBeVisible();

  await answerWithShortcut(page);
  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();
});

test('continues cleanly across a chunk boundary', async ({ page }) => {
  await page.goto('/');
  await seedProgress(page, 999, 100);
  await page.reload();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Question 1,000 / 170,000')).toBeVisible();

  await answerWithShortcut(page);
  await expect(page.getByText('Question 1,001 / 170,000')).toBeVisible();
});

test('reset returns the app to a fresh home state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();
  await answerWithShortcut(page);
  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Reset your saved progress?');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Reset' }).click();

  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.getByText('0.0%')).toBeVisible();
});

test('reset confirmation can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();
  await answerWithShortcut(page);
  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Reset your saved progress?');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Reset' }).click();

  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();
});

test('flashes answer feedback for correct and missed choices', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();

  const firstQuestion = await firstChunkQuestion(page, 0);
  await expect(page.locator('.option-button')).toHaveCount(4);
  await page.locator('.option-button').filter({ hasText: firstQuestion.correctDefinition }).click();
  await expect(page.locator('.option-button--correct')).toBeVisible();

  await expect(page.getByText('Question 2 / 170,000')).toBeVisible();
  const secondQuestion = await firstChunkQuestion(page, 1);
  const wrongOption = secondQuestion.options.find((option) => option !== secondQuestion.correctDefinition);
  if (!wrongOption) throw new Error('Expected an incorrect option for the second question.');

  await page.locator('.option-button').filter({ hasText: wrongOption }).click();
  await expect(page.locator('.option-button--missed')).toBeVisible();
  await expect(page.locator('.option-button--correct')).toHaveCount(0);
  await expect(page.getByText('Missed')).toHaveCount(0);
});

async function seedProgress(page: Page, currentIndex: number, correctCount: number) {
  await page.evaluate(
    async ({ currentIndex, correctCount }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('lexicon-marathon', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('state')) {
            db.createObjectStore('state');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('state', 'readwrite');
        transaction.objectStore('state').put(
          {
            currentIndex,
            correctCount,
            startedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:10:00.000Z'
          },
          'progress'
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
    { currentIndex, correctCount }
  );
}

async function answerWithShortcut(page: Page) {
  await expect(page.locator('.option-button')).toHaveCount(4);
  await page.keyboard.press('1');
}

async function firstChunkQuestion(page: Page, index: number) {
  return page.evaluate(async (questionIndex) => {
    const response = await fetch('/data/chunk-000.json');
    const questions = await response.json();
    return questions[questionIndex] as { correctDefinition: string; options: string[] };
  }, index);
}
