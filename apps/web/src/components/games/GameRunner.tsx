import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Keyboard, RotateCcw, Terminal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Feedback, Game, Level } from "@/games/types";
import { answerLabel, validateAnswer } from "@/games/validation";

const MAX_ATTEMPTS = 3;
const NEXT_LEVEL_DELAY_MS = 800;

const idleFeedback: Feedback = {
  status: "idle",
  message: "Choose an answer or type a command.",
};

export function GameRunner({ game }: { game: Game }) {
  const [levelIndex, setLevelIndex] = useState(0);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(idleFeedback);
  const [attempts, setAttempts] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [isRevealPending, setIsRevealPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextTimerRef = useRef<number | null>(null);

  const level = game.levels[levelIndex];
  const levelNumber = levelIndex + 1;
  const progress = isComplete ? 100 : (levelNumber / game.levels.length) * 100;
  const remainingAttempts = Math.max(MAX_ATTEMPTS - attempts, 0);

  const feedbackStyles = useMemo(() => {
    if (feedback.status === "correct") {
      return "border-primary/40 bg-primary/10 text-foreground";
    }
    if (feedback.status === "incorrect") {
      return "border-destructive/50 bg-destructive/10 text-foreground";
    }
    if (feedback.status === "revealed") {
      return "border-chart-1/50 bg-chart-1/10 text-foreground";
    }
    return "border-border bg-muted/35 text-muted-foreground";
  }, [feedback.status]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (nextTimerRef.current) {
        window.clearTimeout(nextTimerRef.current);
      }
    };
  }, []);

  function advanceLevel() {
    if (levelIndex === game.levels.length - 1) {
      setIsComplete(true);
      setInput("");
      setIsRevealPending(false);
      setFeedback({ status: "idle", message: "Session complete." });
      return;
    }

    setLevelIndex((index) => index + 1);
    setInput("");
    setFeedback(idleFeedback);
    setAttempts(0);
    setIsRevealPending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function queueCorrectAdvance() {
    if (nextTimerRef.current) {
      window.clearTimeout(nextTimerRef.current);
    }
    nextTimerRef.current = window.setTimeout(advanceLevel, NEXT_LEVEL_DELAY_MS);
  }

  function submitAnswer(value: string) {
    if (isComplete || isRevealPending) return;

    if (nextTimerRef.current) {
      window.clearTimeout(nextTimerRef.current);
    }

    if (validateAnswer(value, level)) {
      setSolvedCount((count) => count + 1);
      setFeedback({ status: "correct", message: level.explanation });
      queueCorrectAdvance();
      return;
    }

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);

    if (nextAttempts >= MAX_ATTEMPTS) {
      setRevealedCount((count) => count + 1);
      setIsRevealPending(true);
      setFeedback({
        status: "revealed",
        message: `Answer revealed: ${answerLabel(level)}. ${level.explanation}`,
      });
      return;
    }

    setFeedback({
      status: "incorrect",
      message: `${level.hint} ${MAX_ATTEMPTS - nextAttempts} ${MAX_ATTEMPTS - nextAttempts === 1 ? "try" : "tries"} left.`,
    });
  }

  function restart() {
    if (nextTimerRef.current) {
      window.clearTimeout(nextTimerRef.current);
    }
    setLevelIndex(0);
    setInput("");
    setFeedback(idleFeedback);
    setAttempts(0);
    setSolvedCount(0);
    setRevealedCount(0);
    setIsRevealPending(false);
    setIsComplete(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <>
      <section className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {isComplete ? "Complete" : `Level ${levelNumber}`}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
                    {isComplete
                      ? `${solvedCount} solved, ${revealedCount} revealed.`
                      : level.title}
                  </h3>
                </div>
                <Badge className="w-fit">{isComplete ? "Done" : level.concept}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-lg leading-7 text-foreground">
                {isComplete ? "Pick another game or restart this one." : level.prompt}
              </p>
              {!isComplete && level.code ? <CodeBlock code={level.code} /> : null}
              {!isComplete && level.files && level.files.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {level.files.map((file) => (
                    <Badge key={file} className="justify-start rounded-md px-3 py-2 font-mono text-sm">
                      {file}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {!isComplete && level.mode === "choice" ? (
            <ChoicePanel level={level} disabled={isRevealPending} onSelect={submitAnswer} />
          ) : null}

          {!isComplete && level.mode === "typed" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitAnswer(input);
              }}
              className="grid gap-3 rounded-lg border bg-card p-3 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <span className="hidden pl-2 font-mono text-xl font-semibold text-primary sm:block" aria-hidden="true">
                {level.files && level.files.length > 0 ? "$" : ":"}
              </span>
              <label className="sr-only" htmlFor={`${game.id}-answer`}>
                Answer
              </label>
              <Input
                ref={inputRef}
                id={`${game.id}-answer`}
                value={input}
                disabled={isRevealPending}
                placeholder="type the command"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                className="h-12 border-0 bg-background font-mono text-base shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                onChange={(event) => setInput(event.target.value)}
              />
              <Button type="submit" disabled={isRevealPending} className="h-12">
                Run
                <Keyboard aria-hidden="true" className="h-4 w-4" />
              </Button>
            </form>
          ) : null}

          <section className={`rounded-lg border p-4 shadow-sm transition-colors ${feedbackStyles}`} aria-live="polite">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {feedback.status === "correct" ? <Check className="h-4 w-4 text-primary" /> : null}
                {feedback.status === "incorrect" ? <X className="h-4 w-4 text-destructive" /> : null}
                {feedback.status === "revealed" || feedback.status === "idle" ? (
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                ) : null}
              </div>
              <div className="flex-1 space-y-3">
                <p className="text-sm leading-6">{feedback.message}</p>
                {isRevealPending ? (
                  <Button type="button" variant="secondary" onClick={advanceLevel}>
                    Continue
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold">Run Status</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {isComplete
                  ? "Session complete"
                  : isRevealPending
                    ? "Answer revealed"
                    : `${remainingAttempts} ${remainingAttempts === 1 ? "try" : "tries"} available`}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: MAX_ATTEMPTS }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 rounded-full ${index < attempts ? "bg-destructive" : "bg-muted"}`}
                    aria-label={`Attempt ${index + 1}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border bg-background p-3">
                  <p className="text-muted-foreground">Solved</p>
                  <p className="mt-1 text-2xl font-semibold text-primary">{solvedCount}</p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-muted-foreground">Revealed</p>
                  <p className="mt-1 text-2xl font-semibold text-destructive">{revealedCount}</p>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={restart}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Restart
              </Button>
            </CardContent>
          </Card>
        </aside>
      </section>

      <ConceptNotes game={game} />
    </>
  );
}

function ChoicePanel({
  level,
  disabled,
  onSelect,
}: {
  level: Level;
  disabled: boolean;
  onSelect: (answer: string) => void;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Answer choices">
      {level.choices?.map((choice) => (
        <button
          key={choice.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(choice.id)}
          className="rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        >
          <p className="text-sm font-semibold">{choice.label}</p>
          {choice.code ? <CodeBlock code={choice.code} compact /> : null}
        </button>
      ))}
    </section>
  );
}

function ConceptNotes({ game }: { game: Game }) {
  return (
    <section className="space-y-3" aria-labelledby="concept-notes-heading">
      <div>
        <h2 id="concept-notes-heading" className="text-base font-semibold text-foreground">
          Concept Notes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Quick references for the current game.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {game.notes.map(([term, description]) => (
          <Card key={term} className="h-full">
            <CardContent className="p-4 text-sm">
              <p className="font-mono font-semibold text-primary">{term}</p>
              <p className="mt-2 leading-5 text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function CodeBlock({ code, compact = false }: { code: string; compact?: boolean }) {
  return (
    <pre className={`overflow-x-auto rounded-md border bg-background font-mono text-sm leading-6 text-foreground ${compact ? "mt-3 p-3" : "p-4"}`}>
      <code>{code}</code>
    </pre>
  );
}
