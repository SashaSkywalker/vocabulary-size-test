import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const validateDist = process.argv.includes('--dist');
const dataDir = validateDist
  ? path.join(rootDir, 'dist', 'data')
  : path.join(rootDir, 'public', 'data');

const TARGET_QUESTIONS = 170_000;
const CHUNK_SIZE = 1_000;
const ORDERING = 'single-word prompts without self-referential definitions first';
const CLOUDFLARE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const CLOUDFLARE_MAX_FILES = 20_000;

async function main() {
  await assertExistingDir(dataDir);
  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf8'));

  assert(manifest.totalQuestions === TARGET_QUESTIONS, `manifest totalQuestions must be ${TARGET_QUESTIONS}`);
  assert(manifest.chunkSize === CHUNK_SIZE, `manifest chunkSize must be ${CHUNK_SIZE}`);
  assert(manifest.ordering === ORDERING, `manifest ordering must be "${ORDERING}"`);
  assert(manifest.chunkCount === TARGET_QUESTIONS / CHUNK_SIZE, 'manifest chunkCount must match target/chunk size');
  assert(manifest.chunks.length === manifest.chunkCount, 'manifest chunks length must match chunkCount');

  const ids = new Set();
  let questionCount = 0;
  let maxFileSize = 0;
  let fileCount = 0;
  let previousPriority = 0;
  const orderingBuckets = [0, 0, 0, 0];

  for (const chunk of manifest.chunks) {
    const chunkPath = path.join(dataDir, chunk.file);
    const stat = await fs.stat(chunkPath);
    fileCount += 1;
    maxFileSize = Math.max(maxFileSize, stat.size);
    assert(stat.size < CLOUDFLARE_MAX_FILE_BYTES, `${chunk.file} exceeds Cloudflare Pages 25 MiB asset limit`);

    const questions = JSON.parse(await fs.readFile(chunkPath, 'utf8'));
    assert(questions.length === CHUNK_SIZE, `${chunk.file} should contain ${CHUNK_SIZE} questions`);

    for (const question of questions) {
      questionCount += 1;
      assert(typeof question.id === 'string' && question.id, 'question id is required');
      assert(!ids.has(question.id), `duplicate question id ${question.id}`);
      ids.add(question.id);
      assert(typeof question.word === 'string' && question.word.trim(), `${question.id} has empty word`);
      assert(typeof question.correctDefinition === 'string' && question.correctDefinition.trim(), `${question.id} has empty definition`);
      assert(Array.isArray(question.options) && question.options.length === 4, `${question.id} must have four options`);
      assert(question.options.includes(question.correctDefinition), `${question.id} options must include the correct definition`);
      assert(new Set(question.options).size === 4, `${question.id} has duplicate options`);
      assert(question.chunkIndex === chunk.index, `${question.id} has incorrect chunkIndex`);

      const priority = getQuestionPriority(question);
      assert(priority >= previousPriority, `${question.id} breaks preferred ordering`);
      orderingBuckets[priority] += 1;
      previousPriority = priority;
    }
  }

  assert(
    manifest.orderingBuckets.singleWordNoSelfReference === orderingBuckets[0],
    'singleWordNoSelfReference bucket count does not match generated data'
  );
  assert(
    manifest.orderingBuckets.singleWordSelfReference === orderingBuckets[1],
    'singleWordSelfReference bucket count does not match generated data'
  );
  assert(
    manifest.orderingBuckets.multiWordNoSelfReference === orderingBuckets[2],
    'multiWordNoSelfReference bucket count does not match generated data'
  );
  assert(
    manifest.orderingBuckets.multiWordSelfReference === orderingBuckets[3],
    'multiWordSelfReference bucket count does not match generated data'
  );

  const recursiveFileCount = await countFiles(path.resolve(dataDir, '..'));
  assert(recursiveFileCount <= CLOUDFLARE_MAX_FILES, `static file count ${recursiveFileCount} exceeds Cloudflare Pages free limit`);
  assert(fileCount === manifest.chunkCount, 'validated chunk file count must match manifest');
  assert(questionCount === TARGET_QUESTIONS, `validated ${questionCount} questions instead of ${TARGET_QUESTIONS}`);

  console.log(`Validated ${questionCount.toLocaleString('en-US')} questions from ${dataDir}.`);
  console.log(`Largest data chunk: ${(maxFileSize / 1024 / 1024).toFixed(2)} MiB; static files checked: ${recursiveFileCount}.`);
}

async function assertExistingDir(dir) {
  try {
    const stat = await fs.stat(dir);
    if (stat.isDirectory()) return;
  } catch {
    // Throw below.
  }

  throw new Error(`No generated data directory found at ${dir}. Run npm run data:generate first.`);
}

async function countFiles(dir) {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(entryPath);
    } else {
      count += 1;
    }
  }
  return count;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getQuestionPriority(question) {
  const singleWord = isSingleWordPrompt(question.word);
  const selfReferential = definitionContainsPrompt(question.word, question.correctDefinition);

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
