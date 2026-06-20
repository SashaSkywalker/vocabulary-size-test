import { clearDataCache, fetchChunk, fetchManifest, fetchQuestion } from './lexicon';
import type { Manifest, Question } from './types';

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  title: 'Vocabulary size test',
  sourceRelease: 'Test WordNet',
  sourceUrl: 'https://example.test/source.zip',
  license: 'CC-BY 4.0',
  licenseFile: 'license.txt',
  totalQuestions: 2,
  chunkSize: 1,
  chunkCount: 2,
  ordering: 'test',
  wordLevelQuestions: 2,
  senseTopupQuestions: 0,
  orderingBuckets: {
    singleWordNoSelfReference: 2,
    singleWordSelfReference: 0,
    multiWordNoSelfReference: 0,
    multiWordSelfReference: 0
  },
  sourceSynsets: 2,
  chunks: [
    { index: 0, file: 'chunk-000.json', questionCount: 1, firstId: 'q-000001', lastId: 'q-000001' },
    { index: 1, file: 'chunk-001.json', questionCount: 1, firstId: 'q-000002', lastId: 'q-000002' }
  ]
};

const chunks: Question[][] = [
  [
    {
      id: 'q-000001',
      word: 'alpha',
      correctDefinition: 'first letter',
      options: ['first letter', 'second letter', 'third letter', 'fourth letter'],
      source: 'test',
      chunkIndex: 0,
      partOfSpeech: 'noun',
      category: 'noun.communication'
    }
  ],
  [
    {
      id: 'q-000002',
      word: 'beta',
      correctDefinition: 'second letter',
      options: ['first letter', 'second letter', 'third letter', 'fourth letter'],
      source: 'test',
      chunkIndex: 1,
      partOfSpeech: 'noun',
      category: 'noun.communication'
    }
  ]
];

describe('lexicon data loader', () => {
  beforeEach(() => {
    clearDataCache();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/data/manifest.json') {
        return jsonResponse(manifest);
      }
      if (url === '/data/chunk-000.json') {
        return jsonResponse(chunks[0]);
      }
      if (url === '/data/chunk-001.json') {
        return jsonResponse(chunks[1]);
      }
      return new Response('', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and caches the manifest', async () => {
    await expect(fetchManifest()).resolves.toEqual(manifest);
    await expect(fetchManifest()).resolves.toEqual(manifest);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('loads chunks and resolves questions by absolute index', async () => {
    const loadedManifest = await fetchManifest();

    await expect(fetchChunk(loadedManifest, 0)).resolves.toEqual(chunks[0]);
    await expect(fetchQuestion(loadedManifest, 1)).resolves.toEqual(chunks[1][0]);
  });

  it('rejects invalid question indexes', async () => {
    await expect(fetchQuestion(manifest, 2)).rejects.toThrow('outside');
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
