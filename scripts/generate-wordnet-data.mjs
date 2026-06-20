import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const cacheDir = path.join(rootDir, '.cache', 'wordnet');
const dataDir = path.join(rootDir, 'public', 'data');
const sourceUrl = 'https://en-word.net/static/english-wordnet-2025-plus-json.zip';
const licenseUrl = 'https://raw.githubusercontent.com/globalwordnet/english-wordnet/master/LICENSE.md';
const sourceZipPath = path.join(cacheDir, 'english-wordnet-2025-plus-json.zip');
const licensePath = path.join(dataDir, 'open-english-wordnet-license.txt');

const TARGET_QUESTIONS = 170_000;
const CHUNK_SIZE = 1_000;
const ORDERING = 'single-word prompts without self-referential definitions first';
const POS_ORDER = ['n', 'v', 'a', 's', 'r'];
const POS_LABELS = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  s: 'adjective satellite',
  r: 'adverb'
};

const force = process.argv.includes('--force');

async function main() {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  if (!force && await existingDataIsValid()) {
    console.log('WordNet data already generated.');
    return;
  }

  await downloadIfMissing(sourceUrl, sourceZipPath);
  await downloadTextIfMissing(licenseUrl, licensePath);

  console.log('Parsing Open English WordNet 2025+...');
  const zip = new AdmZip(sourceZipPath);
  const zipEntries = zip.getEntries();
  const synsets = readSynsets(zipEntries);
  const { primaryItems, topupItems } = readLexicalItems(zipEntries, synsets);

  if (primaryItems.length >= TARGET_QUESTIONS) {
    throw new Error(`Unexpected primary item count ${primaryItems.length}; update the selection policy before truncating.`);
  }

  const neededTopup = TARGET_QUESTIONS - primaryItems.length;
  if (topupItems.length < neededTopup) {
    throw new Error(`Only ${topupItems.length} sense-level top-up items are available; need ${neededTopup}.`);
  }

  const selectedTopup = topupItems
    .sort((a, b) => stableHash(a.selectionKey) - stableHash(b.selectionKey))
    .slice(0, neededTopup);

  const selectedItems = [...primaryItems, ...selectedTopup]
    .sort(compareQuestionOrder);

  const orderingBuckets = selectedItems.reduce((buckets, item) => {
    buckets[getQuestionPriority(item)] += 1;
    return buckets;
  }, [0, 0, 0, 0]);

  const selected = selectedItems
    .map((item, index) => ({
      ...item,
      id: `q-${String(index + 1).padStart(6, '0')}`,
      chunkIndex: Math.floor(index / CHUNK_SIZE)
    }));

  const questions = addOptions(selected);
  await writeChunks(questions, {
    primaryCount: primaryItems.length,
    topupCount: selectedTopup.length,
    orderingBuckets,
    sourceSynsets: synsets.size
  });

  console.log(`Generated ${TARGET_QUESTIONS.toLocaleString('en-US')} questions in ${TARGET_QUESTIONS / CHUNK_SIZE} chunks.`);
  console.log(`${primaryItems.length.toLocaleString('en-US')} word-level questions, ${selectedTopup.length.toLocaleString('en-US')} sense-level top-up questions.`);
}

async function existingDataIsValid() {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
    if (manifest.totalQuestions !== TARGET_QUESTIONS || manifest.chunkSize !== CHUNK_SIZE) {
      return false;
    }
    const firstChunk = await fs.stat(path.join(dataDir, 'chunk-000.json'));
    const lastChunk = await fs.stat(path.join(dataDir, 'chunk-169.json'));
    return manifest.ordering === ORDERING && firstChunk.size > 0 && lastChunk.size > 0;
  } catch {
    return false;
  }
}

async function downloadIfMissing(url, outputPath) {
  try {
    const stat = await fs.stat(outputPath);
    if (stat.size > 0) return;
  } catch {
    // Download below.
  }

  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

async function downloadTextIfMissing(url, outputPath) {
  try {
    const stat = await fs.stat(outputPath);
    if (stat.size > 0) return;
  } catch {
    // Download below.
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await fs.writeFile(outputPath, await response.text(), 'utf8');
}

function readJson(zipEntries, name) {
  const entry = zipEntries.find((candidate) => candidate.entryName === name);
  if (!entry) {
    throw new Error(`Missing ${name} in source zip.`);
  }
  return JSON.parse(entry.getData().toString('utf8'));
}

function readSynsets(zipEntries) {
  const synsets = new Map();
  const synsetFiles = zipEntries
    .map((entry) => entry.entryName)
    .filter((name) => name.endsWith('.json') && !name.startsWith('entries-') && name !== 'frames.json')
    .sort();

  for (const fileName of synsetFiles) {
    const category = fileName.replace(/\.json$/, '');
    const payload = readJson(zipEntries, fileName);
    for (const [synsetId, synset] of Object.entries(payload)) {
      const definition = cleanDefinition(synset.definition?.[0]);
      if (!definition) continue;
      synsets.set(synsetId, {
        id: synsetId,
        definition,
        category,
        partOfSpeech: synset.partOfSpeech || synsetId.split('-').at(-1) || 'n',
        members: synset.members || []
      });
    }
  }

  return synsets;
}

function readLexicalItems(zipEntries, synsets) {
  const primaryItems = [];
  const topupItems = [];
  const entryFiles = zipEntries
    .map((entry) => entry.entryName)
    .filter((name) => name.startsWith('entries-') && name.endsWith('.json'))
    .sort((a, b) => entryFileSortKey(a).localeCompare(entryFileSortKey(b)));

  for (const fileName of entryFiles) {
    const entries = readJson(zipEntries, fileName);
    const words = Object.keys(entries).sort((a, b) => a.localeCompare(b, 'en'));
    for (const rawWord of words) {
      const word = cleanWord(rawWord);
      if (!word) continue;

      const senses = collectSensesForWord(word, entries[rawWord], synsets);
      if (!senses.length) continue;

      const primary = {
        ...senses[0],
        itemKind: 'word',
        source: 'Open English WordNet 2025+'
      };
      primaryItems.push(primary);

      for (const sense of senses.slice(1)) {
        if (sense.correctDefinition === primary.correctDefinition) continue;
        topupItems.push({
          ...sense,
          itemKind: 'sense-topup',
          source: 'Open English WordNet 2025+ sense top-up'
        });
      }
    }
  }

  return { primaryItems, topupItems };
}

function collectSensesForWord(word, entry, synsets) {
  const senses = [];
  const posKeys = Object.keys(entry).sort((a, b) => posRank(a) - posRank(b));
  const seenDefinitions = new Set();

  for (const posKey of posKeys) {
    const posEntry = entry[posKey];
    for (const sense of posEntry.sense || []) {
      const synset = synsets.get(sense.synset);
      if (!synset || seenDefinitions.has(synset.definition)) continue;
      seenDefinitions.add(synset.definition);
      senses.push({
        word,
        correctDefinition: synset.definition,
        partOfSpeech: POS_LABELS[posKey] || POS_LABELS[synset.partOfSpeech] || synset.partOfSpeech,
        posKey,
        category: synset.category,
        synsetId: synset.id,
        orderKey: `${word}|${synset.id}|${synset.definition}`,
        selectionKey: `${word}|${synset.id}`
      });
    }
  }

  return senses;
}

function addOptions(items) {
  const byCategory = new Map();
  const byPos = new Map();

  for (const item of items) {
    pushGrouped(byCategory, `${item.posKey}:${item.category}`, item);
    pushGrouped(byPos, item.posKey, item);
  }

  return items.map((item) => {
    const picked = [];
    const pickedDefinitions = new Set([item.correctDefinition]);
    const pools = [
      byCategory.get(`${item.posKey}:${item.category}`) || [],
      byPos.get(item.posKey) || [],
      items
    ];

    for (let poolIndex = 0; poolIndex < pools.length && picked.length < 3; poolIndex += 1) {
      while (picked.length < 3) {
        const candidate = pickDistractor(pools[poolIndex], item, pickedDefinitions, poolIndex, picked.length);
        if (!candidate) break;
        picked.push(candidate.correctDefinition);
        pickedDefinitions.add(candidate.correctDefinition);
      }
    }

    if (picked.length !== 3) {
      throw new Error(`Could not generate three distractors for ${item.word} (${item.synsetId}).`);
    }

    const options = shuffleDeterministically([item.correctDefinition, ...picked], item.orderKey);
    return {
      id: item.id,
      word: item.word,
      correctDefinition: item.correctDefinition,
      options,
      source: item.source,
      chunkIndex: item.chunkIndex,
      partOfSpeech: item.partOfSpeech,
      category: item.category
    };
  });
}

function pickDistractor(pool, item, pickedDefinitions, poolIndex, pickIndex) {
  if (!pool.length) return undefined;
  const start = stableHash(`${item.orderKey}:${poolIndex}:${pickIndex}:start`) % pool.length;
  const rawStep = stableHash(`${item.orderKey}:${poolIndex}:${pickIndex}:step`);
  const step = (rawStep % Math.max(1, pool.length - 1)) + 1;

  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(start + offset * step) % pool.length];
    if (candidate.orderKey === item.orderKey) continue;
    if (candidate.word === item.word) continue;
    if (pickedDefinitions.has(candidate.correctDefinition)) continue;
    return candidate;
  }

  return undefined;
}

async function writeChunks(questions, stats) {
  if (questions.length !== TARGET_QUESTIONS) {
    throw new Error(`Expected ${TARGET_QUESTIONS} questions, got ${questions.length}.`);
  }

  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
  await downloadTextIfMissing(licenseUrl, licensePath);

  const chunkCount = Math.ceil(questions.length / CHUNK_SIZE);
  const chunks = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const chunkQuestions = questions.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const fileName = `chunk-${String(index).padStart(3, '0')}.json`;
    await fs.writeFile(path.join(dataDir, fileName), JSON.stringify(chunkQuestions), 'utf8');
    chunks.push({
      index,
      file: fileName,
      questionCount: chunkQuestions.length,
      firstId: chunkQuestions[0].id,
      lastId: chunkQuestions.at(-1).id
    });
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    title: 'Vocabulary size test',
    sourceRelease: 'Open English WordNet 2025+',
    sourceUrl,
    license: 'CC-BY 4.0',
    licenseFile: 'open-english-wordnet-license.txt',
    totalQuestions: TARGET_QUESTIONS,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    ordering: ORDERING,
    wordLevelQuestions: stats.primaryCount,
    senseTopupQuestions: stats.topupCount,
    orderingBuckets: {
      singleWordNoSelfReference: stats.orderingBuckets[0],
      singleWordSelfReference: stats.orderingBuckets[1],
      multiWordNoSelfReference: stats.orderingBuckets[2],
      multiWordSelfReference: stats.orderingBuckets[3]
    },
    sourceSynsets: stats.sourceSynsets,
    chunks
  };

  await fs.writeFile(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function pushGrouped(map, key, value) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function cleanDefinition(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanWord(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function posRank(pos) {
  const rank = POS_ORDER.indexOf(pos);
  return rank === -1 ? POS_ORDER.length : rank;
}

function entryFileSortKey(fileName) {
  return fileName.replace('entries-', '').replace('.json', '').padStart(2, '0');
}

function compareQuestionOrder(left, right) {
  const priority = getQuestionPriority(left) - getQuestionPriority(right);
  if (priority !== 0) return priority;
  return stableHash(left.orderKey) - stableHash(right.orderKey);
}

function getQuestionPriority(item) {
  const singleWord = isSingleWordPrompt(item.word);
  const selfReferential = definitionContainsPrompt(item.word, item.correctDefinition);

  if (singleWord && !selfReferential) return 0;
  if (singleWord) return 1;
  if (!selfReferential) return 2;
  return 3;
}

function isSingleWordPrompt(word) {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word.trim());
}

function definitionContainsPrompt(word, definition) {
  const promptTokens = tokenizeForSelfReference(word);
  if (!promptTokens.length) return false;

  const definitionTokens = new Set(tokenizeForSelfReference(definition));
  return promptTokens.some((token) => definitionTokens.has(token));
}

function tokenizeForSelfReference(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function shuffleDeterministically(values, seed) {
  const output = [...values];
  let state = stableHash(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = nextHashState(state);
    const swapIndex = state % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function nextHashState(value) {
  return (Math.imul(value ^ (value >>> 15), 2_246_822_507) + 3_266_489_917) >>> 0;
}

function stableHash(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
