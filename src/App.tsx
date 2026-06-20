import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, FlaskConical, Play, RotateCcw, Timer, Trophy } from 'lucide-react';
import { fetchManifest, fetchQuestion } from './data/lexicon';
import type { Manifest, Question } from './data/types';
import {
  applyAnswer,
  clampProgress,
  createEmptyProgress,
  formatPercent,
  getAccuracy,
  type ProgressState
} from './lib/progress';
import { clearProgress, loadProgress, saveProgress } from './storage/progressDb';

type Screen = 'loading' | 'home' | 'quiz' | 'results' | 'error';
type AnswerFlash = {
  selectedDefinition: string;
  isCorrect: boolean;
};

function App() {
  const [manifest, setManifest] = useState<Manifest>();
  const [progress, setProgress] = useState<ProgressState>();
  const [question, setQuestion] = useState<Question>();
  const [screen, setScreen] = useState<Screen>('loading');
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [lastResult, setLastResult] = useState<'correct' | 'missed'>();
  const [answerFlash, setAnswerFlash] = useState<AnswerFlash>();

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const loadedManifest = await fetchManifest();
        const storedProgress = await loadProgress();
        const safeProgress = storedProgress ? clampProgress(storedProgress, loadedManifest.totalQuestions) : undefined;

        if (!mounted) return;
        setManifest(loadedManifest);
        setProgress(safeProgress);
        setScreen(safeProgress?.currentIndex === loadedManifest.totalQuestions ? 'results' : 'home');
      } catch (caught) {
        if (!mounted) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load Vocabulary size test.');
        setScreen('error');
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadQuestion() {
      if (!manifest || !progress || screen !== 'quiz') return;
      if (progress.currentIndex >= manifest.totalQuestions) {
        setQuestion(undefined);
        setScreen('results');
        return;
      }

      try {
        const nextQuestion = await fetchQuestion(manifest, progress.currentIndex);
        if (mounted) setQuestion(nextQuestion);
      } catch (caught) {
        if (!mounted) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load the next question.');
        setScreen('error');
      }
    }

    void loadQuestion();

    return () => {
      mounted = false;
    };
  }, [manifest, progress, screen]);

  const stats = useMemo(() => {
    const answered = progress?.currentIndex ?? 0;
    const correct = progress?.correctCount ?? 0;
    return {
      answered,
      correct,
      remaining: Math.max(0, (manifest?.totalQuestions ?? 0) - answered),
      accuracy: getAccuracy(correct, answered)
    };
  }, [manifest, progress]);

  const startFresh = useCallback(async () => {
    if (!manifest) return;
    const nextProgress = createEmptyProgress();
    await saveProgress(nextProgress);
    setProgress(nextProgress);
    setLastResult(undefined);
    setAnswerFlash(undefined);
    setScreen('quiz');
  }, [manifest]);

  const continueTest = useCallback(async () => {
    if (!manifest) return;
    if (!progress) {
      await startFresh();
      return;
    }
    setLastResult(undefined);
    setAnswerFlash(undefined);
    setScreen(progress.currentIndex >= manifest.totalQuestions ? 'results' : 'quiz');
  }, [manifest, progress, startFresh]);

  const resetTest = useCallback(async () => {
    if (progress && progress.currentIndex > 0) {
      const confirmed = window.confirm('Reset your saved progress? This cannot be undone.');
      if (!confirmed) return;
    }

    await clearProgress();
    setProgress(undefined);
    setQuestion(undefined);
    setLastResult(undefined);
    setAnswerFlash(undefined);
    setScreen('home');
  }, [progress]);

  const answerQuestion = useCallback(
    async (selectedDefinition: string) => {
      if (!manifest || !progress || !question || isSaving || answerFlash) return;

      const isCorrect = selectedDefinition === question.correctDefinition;
      const nextProgress = applyAnswer(progress, isCorrect, manifest.totalQuestions);
      setIsSaving(true);
      setLastResult(isCorrect ? 'correct' : 'missed');
      setAnswerFlash({ selectedDefinition, isCorrect });

      try {
        await Promise.all([saveProgress(nextProgress), delay(520)]);
        setAnswerFlash(undefined);
        setProgress(nextProgress);
        if (nextProgress.currentIndex >= manifest.totalQuestions) {
          setQuestion(undefined);
          setScreen('results');
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to save progress.');
        setScreen('error');
      } finally {
        setIsSaving(false);
      }
    },
    [answerFlash, isSaving, manifest, progress, question]
  );

  useEffect(() => {
    if (screen !== 'quiz' || !question) return;
    const currentQuestion = question;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const optionIndex = Number(event.key) - 1;
      if (optionIndex >= 0 && optionIndex < 4) {
        event.preventDefault();
        void answerQuestion(currentQuestion.options[optionIndex]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answerQuestion, question, screen]);

  if (screen === 'loading') {
    return <Shell><LoadingState /></Shell>;
  }

  if (screen === 'error') {
    return (
      <Shell>
        <section className="panel error-panel">
          <p className="eyebrow">Load failure</p>
          <h1>Vocabulary size test is unavailable</h1>
          <p>{error}</p>
        </section>
      </Shell>
    );
  }

  if (!manifest) {
    return null;
  }

  return (
    <Shell>
      {screen === 'home' && (
        <HomeScreen
          manifest={manifest}
          progress={progress}
          stats={stats}
          onStart={startFresh}
          onContinue={continueTest}
          onReset={resetTest}
        />
      )}
      {screen === 'quiz' && progress && (
        <QuizScreen
          manifest={manifest}
          progress={progress}
          question={question}
          stats={stats}
          isSaving={isSaving}
          lastResult={lastResult}
          answerFlash={answerFlash}
          onAnswer={answerQuestion}
          onExit={() => setScreen('home')}
          onReset={resetTest}
        />
      )}
      {screen === 'results' && progress && (
        <ResultsScreen manifest={manifest} progress={progress} stats={stats} onReset={resetTest} />
      )}
    </Shell>
  );
}

interface ShellProps {
  children: React.ReactNode;
}

function Shell({ children }: ShellProps) {
  return (
    <main className="app-shell">
      <div className="app-frame">{children}</div>
      <footer className="attribution">
        Data: Open English WordNet, derived from Princeton WordNet.{' '}
        <a href="/data/open-english-wordnet-license.txt">CC BY 4.0</a>.
      </footer>
    </main>
  );
}

function LoadingState() {
  return (
    <section className="panel loading-panel">
      <FlaskConical aria-hidden="true" />
      <p className="eyebrow">Preparing dataset</p>
      <h1>Loading Vocabulary size test</h1>
    </section>
  );
}

interface HomeScreenProps {
  manifest: Manifest;
  progress: ProgressState | undefined;
  stats: ReturnType<typeof getStatsShape>;
  onStart: () => void;
  onContinue: () => void;
  onReset: () => void;
}

function HomeScreen({ manifest, progress, stats, onStart, onContinue, onReset }: HomeScreenProps) {
  const hasProgress = Boolean(progress && progress.currentIndex > 0);

  return (
    <section className="home-grid">
      <div className="intro">
        <h1>Vocabulary size test</h1>
        <p className="intro-copy">
          A focused English vocabulary exam built from Open English WordNet.
        </p>
        <div className="action-row">
          <button className="primary-button" type="button" onClick={hasProgress ? onContinue : onStart}>
            <Play size={18} aria-hidden="true" />
            {hasProgress ? 'Continue' : 'Start'}
          </button>
          {hasProgress && (
            <button className="secondary-button" type="button" onClick={onReset}>
              <RotateCcw size={18} aria-hidden="true" />
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="metrics-grid" aria-label="Test status">
        <Metric icon={<Database />} label="Questions" value={manifest.totalQuestions.toLocaleString('en-US')} />
        <Metric icon={<Timer />} label="Answered" value={stats.answered.toLocaleString('en-US')} />
        <Metric icon={<Trophy />} label="Accuracy" value={formatPercent(stats.accuracy)} />
      </div>
    </section>
  );
}

interface QuizScreenProps {
  manifest: Manifest;
  progress: ProgressState;
  question: Question | undefined;
  stats: ReturnType<typeof getStatsShape>;
  isSaving: boolean;
  lastResult: 'correct' | 'missed' | undefined;
  answerFlash: AnswerFlash | undefined;
  onAnswer: (definition: string) => void;
  onExit: () => void;
  onReset: () => void;
}

function QuizScreen({ manifest, progress, question, stats, isSaving, lastResult, answerFlash, onAnswer, onExit, onReset }: QuizScreenProps) {
  const questionNumber = progress.currentIndex + 1;

  return (
    <section className="quiz-layout">
      <header className="quiz-header">
        <div>
          <p className="eyebrow">Question {questionNumber.toLocaleString('en-US')} / {manifest.totalQuestions.toLocaleString('en-US')}</p>
          <h1>Choose the matching definition</h1>
        </div>
        <div className="header-actions">
          <button className="text-button" type="button" onClick={onExit}>Exit</button>
          <button className="text-button danger" type="button" onClick={onReset}>Reset</button>
        </div>
      </header>

      <div className="stat-strip">
        <span>{stats.correct.toLocaleString('en-US')} correct</span>
        <span>{stats.remaining.toLocaleString('en-US')} left</span>
      </div>

      <div className="question-panel">
        {question ? (
          <>
            <div className="word-block">
              <h2>{question.word}</h2>
            </div>
            <div className="options-grid">
              {question.options.map((option, index) => (
                <button
                  className={getOptionClassName(option, question.correctDefinition, answerFlash)}
                  type="button"
                  key={option}
                  onClick={() => onAnswer(option)}
                  disabled={isSaving || Boolean(answerFlash)}
                >
                  <span>{index + 1}</span>
                  {option}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="question-loading">Loading next question</div>
        )}
      </div>

      <div className="feedback-line" aria-live="polite">
        {lastResult === 'correct' && 'Correct'}
      </div>
    </section>
  );
}

interface ResultsScreenProps {
  manifest: Manifest;
  progress: ProgressState;
  stats: ReturnType<typeof getStatsShape>;
  onReset: () => void;
}

function ResultsScreen({ manifest, progress, stats, onReset }: ResultsScreenProps) {
  return (
    <section className="results-panel">
      <p className="eyebrow">Complete</p>
      <h1>170,000 steps finished</h1>
      <div className="metrics-grid results">
        <Metric icon={<Database />} label="Answered" value={manifest.totalQuestions.toLocaleString('en-US')} />
        <Metric icon={<Trophy />} label="Correct" value={progress.correctCount.toLocaleString('en-US')} />
        <Metric icon={<Timer />} label="Accuracy" value={formatPercent(stats.accuracy)} />
      </div>
      <button className="primary-button" type="button" onClick={onReset}>
        <RotateCcw size={18} aria-hidden="true" />
        Start over
      </button>
    </section>
  );
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="metric">
      <span className="metric-icon" aria-hidden="true">{icon}</span>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getStatsShape() {
  return {
    answered: 0,
    correct: 0,
    remaining: 0,
    accuracy: 0
  };
}

function getOptionClassName(option: string, _correctDefinition: string, answerFlash: AnswerFlash | undefined) {
  if (!answerFlash) return 'option-button';
  if (option === answerFlash.selectedDefinition) {
    return answerFlash.isCorrect ? 'option-button option-button--correct' : 'option-button option-button--missed';
  }
  return 'option-button option-button--muted';
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default App;
