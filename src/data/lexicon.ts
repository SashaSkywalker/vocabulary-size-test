import type { Manifest, Question } from './types';

let manifestPromise: Promise<Manifest> | undefined;
const chunkCache = new Map<number, Promise<Question[]>>();

export function clearDataCache() {
  manifestPromise = undefined;
  chunkCache.clear();
}

export async function fetchManifest(): Promise<Manifest> {
  manifestPromise ??= fetchJson<Manifest>('/data/manifest.json');
  return manifestPromise;
}

export async function fetchQuestion(manifest: Manifest, questionIndex: number): Promise<Question> {
  if (questionIndex < 0 || questionIndex >= manifest.totalQuestions) {
    throw new Error(`Question index ${questionIndex} is outside 0-${manifest.totalQuestions - 1}.`);
  }

  const chunkIndex = Math.floor(questionIndex / manifest.chunkSize);
  const chunk = await fetchChunk(manifest, chunkIndex);
  const question = chunk[questionIndex % manifest.chunkSize];

  if (!question) {
    throw new Error(`Question ${questionIndex} is missing from chunk ${chunkIndex}.`);
  }

  return question;
}

export async function fetchChunk(manifest: Manifest, chunkIndex: number): Promise<Question[]> {
  if (chunkIndex < 0 || chunkIndex >= manifest.chunkCount) {
    throw new Error(`Chunk index ${chunkIndex} is outside 0-${manifest.chunkCount - 1}.`);
  }

  const chunkMeta = manifest.chunks[chunkIndex];
  if (!chunkMeta) {
    throw new Error(`Chunk ${chunkIndex} is missing from manifest.`);
  }

  if (!chunkCache.has(chunkIndex)) {
    chunkCache.set(chunkIndex, fetchJson<Question[]>(`/data/${chunkMeta.file}`));
  }

  return chunkCache.get(chunkIndex)!;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
