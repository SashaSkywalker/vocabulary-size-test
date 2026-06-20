export interface Question {
  id: string;
  word: string;
  correctDefinition: string;
  options: string[];
  source: string;
  chunkIndex: number;
  partOfSpeech: string;
  category: string;
}

export interface DataChunk {
  index: number;
  file: string;
  questionCount: number;
  firstId: string;
  lastId: string;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  title: string;
  sourceRelease: string;
  sourceUrl: string;
  license: string;
  licenseFile: string;
  totalQuestions: number;
  chunkSize: number;
  chunkCount: number;
  ordering: string;
  wordLevelQuestions: number;
  senseTopupQuestions: number;
  orderingBuckets: {
    singleWordNoSelfReference: number;
    singleWordSelfReference: number;
    multiWordNoSelfReference: number;
    multiWordSelfReference: number;
  };
  sourceSynsets: number;
  chunks: DataChunk[];
}
