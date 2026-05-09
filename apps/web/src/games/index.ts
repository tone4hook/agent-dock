import { bugHunter } from "@/games/bugHunter";
import { commandBuilder } from "@/games/commandBuilder";
import { typeDungeon } from "@/games/typeDungeon";
import { vimNinja } from "@/games/vimNinja";

export const games = [typeDungeon, bugHunter, vimNinja, commandBuilder] as const;
