import type { Level } from "@/games/types";

export function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateAnswer(value: string, level: Level): boolean {
  const normalized = normalizeAnswer(value);

  if (level.mode === "choice") {
    return normalized === level.answer;
  }

  if (level.acceptedPatterns?.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const accepted = level.acceptedAnswers ?? [level.answer];
  return accepted.some((answer) => normalizeAnswer(answer) === normalized);
}

export function answerLabel(level: Level): string {
  if (level.mode === "choice") {
    const choice = level.choices?.find((item) => item.id === level.answer);
    return choice?.code ?? choice?.label ?? level.answer;
  }

  return level.answer;
}
