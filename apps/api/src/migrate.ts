import { migrate, openDatabase } from "@agent-dock/db";

const db = openDatabase();
migrate(db);
console.log("Agent*Dock database is up to date.");
