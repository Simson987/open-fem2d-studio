import { useState, useEffect, useCallback, useRef } from "react";
import { getSetting, setSetting } from "../store";

export interface RecentFile {
  path: string;
  name: string;
  type: "report" | "ifc" | "project" | "unknown";
  timestamp: number;
  tenant?: string;
}

const STORE_KEY = "recentFiles";
const MAX_RECENT = 10;

function inferType(path: string): RecentFile["type"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ifc" || ext === "ifcx") return "ifc";
  if (ext === "ifcfem" || ext === "ifcfem2d") return "project";
  if (ext === "json") return "report";
  return "unknown";
}

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  // De laatste lijst, al voordat React opnieuw rendert. Opent de
  // bestandskoppeling (#90) meerdere bestanden kort na elkaar, dan bouwt elk
  // `addRecentFile` voort op het vorige; met de lijst uit de closure van de
  // vorige render viel er een bestand weg.
  const lijstRef = useRef<RecentFile[]>([]);

  const zet = useCallback(async (updated: RecentFile[]) => {
    lijstRef.current = updated;
    setRecentFiles(updated);
    await setSetting(STORE_KEY, updated);
  }, []);

  useEffect(() => {
    getSetting<RecentFile[]>(STORE_KEY, []).then((files) => {
      lijstRef.current = files;
      setRecentFiles(files);
      setLoaded(true);
    });
  }, []);

  const addRecentFile = useCallback(
    async (pathOrFile: string | RecentFile) => {
      const file: RecentFile =
        typeof pathOrFile === "string"
          ? {
              path: pathOrFile,
              name: pathOrFile.split(/[/\\]/).pop() ?? pathOrFile,
              type: inferType(pathOrFile),
              timestamp: Date.now(),
            }
          : { ...pathOrFile, timestamp: Date.now() };

      await zet(
        [file, ...lijstRef.current.filter((f) => f.path !== file.path)].slice(0, MAX_RECENT),
      );
    },
    [zet]
  );

  const removeRecentFile = useCallback(
    async (path: string) => {
      await zet(lijstRef.current.filter((f) => f.path !== path));
    },
    [zet]
  );

  const clearRecentFiles = useCallback(async () => {
    await zet([]);
  }, [zet]);

  return { recentFiles, loaded, addRecentFile, removeRecentFile, clearRecentFiles };
}
