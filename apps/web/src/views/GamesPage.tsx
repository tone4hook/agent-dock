import { useState } from "react";
import { Check } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Badge } from "@/components/ui/badge";
import { GameRunner } from "@/components/games/GameRunner";
import { games } from "@/games";
import type { GameId } from "@/games/types";

export function GamesPage() {
  const [activeGameId, setActiveGameId] = useState<GameId>("type-dungeon");
  const activeGame = games.find((game) => game.id === activeGameId) ?? games[0];

  return (
    <>
      <TopBar title="Games" sub={`${activeGame.title} — ${activeGame.subtitle}`} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl space-y-5 px-5 py-5">
          <header className="rounded-lg border bg-card p-5 shadow-sm">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              {activeGame.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {activeGame.description}
            </p>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Game picker">
            {games.map((game) => {
              const active = activeGameId === game.id;
              return (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => setActiveGameId(game.id)}
                  className={`rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge className={active ? "border-primary bg-primary text-primary-foreground" : undefined}>
                      {game.accent}
                    </Badge>
                    {active ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{game.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{game.subtitle}</p>
                </button>
              );
            })}
          </section>

          <GameRunner key={activeGame.id} game={activeGame} />
        </div>
      </div>
    </>
  );
}
