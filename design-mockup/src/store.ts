import { load, type Store } from "@tauri-apps/plugin-store";
import { isTauriApp } from "./lib/tauri";

let _store: Store | null = null;
const BROWSER_KEY_PREFIX = "open-fem-studio:setting:";
const browserListeners = new Map<string, Set<(value: unknown) => void>>();

function browserKey(key: string): string {
  return `${BROWSER_KEY_PREFIX}${key}`;
}

function readBrowserSetting<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(browserKey(key));
    return raw === null ? fallback : (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await load("preferences.json", { autoSave: true, defaults: {} });
  }
  return _store;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!isTauriApp()) {
    return typeof window === "undefined" ? fallback : readBrowserSetting(key, fallback);
  }
  try {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  if (!isTauriApp()) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(browserKey(key), JSON.stringify(value));
        browserListeners.get(key)?.forEach(listener => listener(value));
      } catch {
        // Storage can be disabled in private browsing; keep the app usable.
      }
    }
    return;
  }
  try {
    const store = await getStore();
    await store.set(key, value);
  } catch {
    // silently fail if store unavailable
  }
}

/**
 * Abonneer op wijzigingen van één setting (Tauri plugin-store `onKeyChange`).
 * Retourneert een unsubscribe-functie; de browser gebruikt localStorage.
 */
export async function onSettingChange<T>(
  key: string,
  cb: (value: T | undefined) => void,
): Promise<() => void> {
  if (!isTauriApp()) {
    if (typeof window === "undefined") return () => {};
    const listeners = browserListeners.get(key) ?? new Set();
    listeners.add(cb as (value: unknown) => void);
    browserListeners.set(key, listeners);
    const onStorage = (event: StorageEvent) => {
      if (event.key === browserKey(key)) cb(readBrowserSetting<T | undefined>(key, undefined));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb as (value: unknown) => void);
      if (listeners.size === 0) browserListeners.delete(key);
      window.removeEventListener("storage", onStorage);
    };
  }
  try {
    const store = await getStore();
    return await store.onKeyChange<T>(key, (value) => cb(value ?? undefined));
  } catch {
    return () => {};
  }
}
