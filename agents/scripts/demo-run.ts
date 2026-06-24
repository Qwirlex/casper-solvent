import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startDataAgent } from "../src/dataAgent/server.js";
import { startRiskAgent } from "../src/riskAgent/server.js";
import { runCycle, type CycleRecord } from "../src/fundAgent/loop.js";

// Drives a short local demo. Starts the service agents, runs several cycles, and
// writes the dashboard log so the page shows a real Gemini driven loop. No funded
// chain needed.
const CYCLES = Number(process.env.DEMO_CYCLES ?? 3);
const LOG_PATH = "../dashboard/loop-log.json";

async function main(): Promise<void> {
  const data = startDataAgent(4001);
  const risk = startRiskAgent(4002);
  await new Promise((r) => setTimeout(r, 500));
  const records: CycleRecord[] = [];
  try {
    for (let i = 0; i < CYCLES; i++) {
      console.log(`--- cycle ${i + 1} of ${CYCLES} ---`);
      records.push(await runCycle());
    }
  } finally {
    data.close();
    risk.close();
  }
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await writeFile(LOG_PATH, JSON.stringify(records, null, 2));
  console.log(`wrote ${records.length} cycles to ${LOG_PATH}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
