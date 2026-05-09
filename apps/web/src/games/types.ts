export type FeedbackStatus = "idle" | "correct" | "incorrect" | "revealed";

export type Feedback = {
  status: FeedbackStatus;
  message: string;
};

export type Choice = {
  id: string;
  label: string;
  code?: string;
};

export type Level = {
  id: number;
  title: string;
  prompt: string;
  concept: string;
  mode: "choice" | "typed";
  code?: string;
  files?: string[];
  choices?: Choice[];
  answer: string;
  acceptedAnswers?: string[];
  acceptedPatterns?: RegExp[];
  hint: string;
  explanation: string;
};

export type GameId = "type-dungeon" | "bug-hunter" | "vim-ninja" | "command-builder";

export type Game = {
  id: GameId;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  levels: Level[];
  notes: Array<[string, string]>;
};
