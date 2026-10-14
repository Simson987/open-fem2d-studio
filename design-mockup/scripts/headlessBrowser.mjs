// Eén startpunt voor de headless Chromium/Edge van de UI-tests.
//
// Edge headless blijft op Windows af en toe hangen (component-updater,
// achtergrondnetwerk van het profiel): dezelfde test deed er de ene keer 1 s over
// en de andere keer liep hij tegen de tijdslimiet aan zonder één check. Daarom:
//   - de achtergronddiensten uit (netwerk, componentupdates, extensies, sync);
//   - per poging een eigen, korte klok (90 s);
//   - bij een verlopen klok nog twee pogingen, met een vers profiel.
// Een echte fout (exitcode ≠ 0 zonder klok) wordt NIET herhaald: die hoort
// zichtbaar te falen.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const STIL = [
  "--disable-background-networking", "--disable-component-update", "--disable-extensions",
  "--disable-sync", "--disable-default-apps", "--no-pings", "--metrics-recording-only",
];
// De Ubuntu-runners van CI staan geen gebruikersnamespaces toe; Chromium stopt
// daar met "No usable sandbox". Alleen daar zonder sandbox: de pagina is een
// eigen testbestand, geen website.
const ZONDER_SANDBOX = process.platform === "linux" && process.env.CI
  // GitHub-runners hebben weinig /dev/shm; grote WebGL-proeven kunnen
  // daardoor vastlopen zonder resultaat. Laat Chrome /tmp gebruiken.
  ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
export const KLOK_PER_POGING_MS = 90_000;
const POGINGEN = 3;

/** Zelfde vorm als `spawnSync(browser, args, opties)`, met herkansing bij een hang. */
export function startBrowser(browser, args, opties = {}) {
  let laatste;
  for (let poging = 1; poging <= POGINGEN; poging++) {
    // Een vers profiel per herkansing: een half geschreven profiel kan de volgende start ook laten hangen.
    const a = args.map((x) => (poging > 1 && x.startsWith("--user-data-dir=") ? `${x}-poging${poging}` : x));
    laatste = spawnSync(browser, [...STIL, ...ZONDER_SANDBOX, ...a], { ...opties, timeout: KLOK_PER_POGING_MS });
    const verlopen = laatste.error?.code === "ETIMEDOUT" || (laatste.signal && laatste.status === null);
    if (!verlopen) return laatste;
    process.stderr.write(`[headless] poging ${poging} bleef hangen na ${KLOK_PER_POGING_MS / 1000} s; opnieuw\n`);
  }
  return laatste;
}

/**
 * Lees een browsertestresultaat zodra #uitslag gevuld is. Bij WebGL-tests kan
 * --dump-dom na de laatste assert blijven wachten op zijn virtuele tijdbudget,
 * terwijl de software-GPU blijft renderen. CDP leest alleen het resultaat;
 * de testpagina voert dezelfde assertions uit als bij --dump-dom.
 */
export async function browserResult(browser, args, timeoutMs = 120_000) {
  const profile = args.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  if (!profile) throw new Error("Een apart browserprofiel is vereist voor CDP");
  const child = spawn(browser, [...STIL, ...ZONDER_SANDBOX, "--remote-debugging-port=0", ...args], {
    stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32",
  });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-1500); });
  const deadline = Date.now() + timeoutMs;
  let socket;
  try {
    const portFile = `${profile}/DevToolsActivePort`;
    let port;
    let portFout = "";
    while (!port) {
      if (Date.now() >= deadline || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Browser start niet${portFout ? ` (${portFout})` : ""}: ${stderr}`);
      }
      try {
        // Edge op Windows maakt het bestand zichtbaar voordat hij de inhoud
        // vrijgeeft: lezen kan dan kort EBUSY geven (#46).
        if (existsSync(portFile)) {
          const eersteRegel = readFileSync(portFile, "utf8").split("\n")[0].trim();
          if (/^[1-9]\d*$/.test(eersteRegel)) port = eersteRegel;
        }
      } catch (error) {
        if (error?.code !== "EBUSY" && error?.code !== "ENOENT") throw error;
        portFout = error.message;
      }
      if (!port) await delay(100);
    }
    let page;
    while (!page && Date.now() < deadline) {
      try {
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
        page = tabs.find((tab) => tab.type === "page" && tab.url.startsWith("file:"));
      } catch { /* Browser is nog bezig met starten. */ }
      if (!page) await delay(100);
    }
    if (!page) throw new Error(`Browserpagina start niet: ${stderr}`);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }),
      delay(3000).then(() => { throw new Error("CDP-verbinding kwam niet op"); }),
    ]);
    let id = 0;
    let progress = "";
    while (Date.now() < deadline) {
      const requestId = ++id;
      const response = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id !== requestId) return;
          clearTimeout(timer);
          resolve(message.result?.result?.value ?? null);
        };
      });
      socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: {
        expression: "JSON.stringify({report:document.getElementById('uitslag')?.textContent || '',test:document.body?.dataset.openFem3dCurrentTest,done:document.body?.dataset.openFem3dCompletedTests})", returnByValue: true,
      } }));
      const value = await response;
      if (value) {
        const state = JSON.parse(value);
        if (state.test) progress = `${state.done ?? "0"} klaar; bezig met ${state.test}`;
        if (state.report) return JSON.parse(state.report);
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(200);
    }
    throw new Error(`Browsertest gaf binnen ${timeoutMs / 1000} s geen resultaat${progress ? ` (${progress})` : ""}: ${stderr}`);
  } finally {
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") child.kill();
      else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } }
    }
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
    }
    // Chrome-hulpprocessen sluiten iets later hun profielbestanden. De caller
    // kan de tijdelijke map pas daarna betrouwbaar verwijderen.
    await delay(300);
  }
}
