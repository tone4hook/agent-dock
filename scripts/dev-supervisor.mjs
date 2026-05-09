import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import treeKill from "tree-kill";

const children = [];
let shuttingDown = false;

const commands = [
  ["api", "npm", ["run", "dev", "-w", "@agent-dock/api"]],
  ["web", "npm", ["run", "dev", "-w", "@agent-dock/web"]],
  ["desktop", "npm", ["run", "neutralino:dev"]],
];

await assertPortsFree([
  ["Agent*Dock API", 8792],
  ["Vite web", 5173],
]);

const build = spawnSync("npm", ["run", "build:packages"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

for (const [name, command, args] of commands) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${name} exited unexpectedly (${signal ?? code}).`);
      void shutdown(1);
    }
  });
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

async function assertPortsFree(ports) {
  const occupied = [];
  for (const [name, port] of ports) {
    if (await isPortOpen(port)) occupied.push(`${name} port ${port}`);
  }
  if (occupied.length > 0) {
    console.error(`Cannot start dev server; already in use: ${occupied.join(", ")}.`);
    console.error("Stop the existing process first, then rerun npm run dev.");
    process.exit(1);
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(300, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.pid) treeKill(child.pid, "SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  for (const { child } of children) {
    if (child.pid && child.exitCode === null) treeKill(child.pid, "SIGKILL");
  }
  process.exit(code);
}
