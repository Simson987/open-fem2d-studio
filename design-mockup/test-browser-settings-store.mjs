import assert from "node:assert/strict";
import { getSetting, onSettingChange, setSetting } from "./src/store.ts";

const previousWindow = globalThis.window;
const entries = new Map();
const browser = new EventTarget();
browser.localStorage = {
  getItem: key => entries.get(key) ?? null,
  setItem: (key, value) => { entries.set(key, String(value)); },
};

try {
  assert.equal(await getSetting("solverPreference", "automatic"), "automatic");
  globalThis.window = browser;
  assert.equal(await getSetting("solverPreference", "automatic"), "automatic");

  const changes = [];
  const unsubscribe = await onSettingChange("solverPreference", value => changes.push(value));
  await setSetting("solverPreference", "openaec-native-fem");
  assert.equal(await getSetting("solverPreference", "automatic"), "openaec-native-fem");
  assert.deepEqual(changes, ["openaec-native-fem"]);
  assert.equal(entries.get("open-fem-studio:setting:solverPreference"),
    '"openaec-native-fem"');

  entries.set("open-fem-studio:setting:solverPreference", '"automatic"');
  const storageEvent = new Event("storage");
  Object.defineProperty(storageEvent, "key", {
    value: "open-fem-studio:setting:solverPreference",
  });
  browser.dispatchEvent(storageEvent);
  assert.deepEqual(changes, ["openaec-native-fem", "automatic"]);
  unsubscribe();
  await setSetting("solverPreference", "openaec-native-fem");
  assert.equal(changes.length, 2);

  entries.set("open-fem-studio:setting:solverPreference", "{invalid");
  assert.equal(await getSetting("solverPreference", "automatic"), "automatic");
  entries.set("open-fem-studio:setting:solverPreference", "null");
  assert.equal(await getSetting("solverPreference", "automatic"), "automatic");
  console.log("Browser settings persist the native solver choice and notify subscribers.");
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}
