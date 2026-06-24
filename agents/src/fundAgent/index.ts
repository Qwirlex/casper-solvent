import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runCycle, type CycleRecord } from "./loop.js";

// Runner. Appends each cycle to the dashboard log so the page shows the live loop.
const LOG_PATH = process.env.LOOP_LOG ?? "../dashboard/loop-log.json";
const INTERVAL_MS = Number(process.env.CYCLE_INTERVAL_MS ?? 60_000);

async function appendCycle(rec: CycleRecord): Promise<void> {
  let arr: CycleRecord[] = [];
  try {
    arr = JSON.parse(await readFile(LOG_PATH, "utf8"));
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  arr.push(rec);
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await writeFile(LOG_PATH, JSON.stringify(arr, null, 2));
}

const once = process.argv.includes("--once");

async function main(): Promise<void> {
  for (;;) {
    try {
      const rec = await runCycle();
      await appendCycle(rec);
      console.log(`cycle written, rebalance ${rec.rebalanceTxHash}`);
    } catch (e) {
      console.error("cycle failed", e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main();
