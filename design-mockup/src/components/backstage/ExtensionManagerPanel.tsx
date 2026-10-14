import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExtensieStore } from "../../extensies/extensieStore";
import "./ExtensionManagerPanel.css";

export default function ExtensionManagerPanel() {
  const { t } = useTranslation("backstage");
  const kaarten = useExtensieStore((state) => state.kaarten);
  const laadfout = useExtensieStore((state) => state.fout);
  const laden = useExtensieStore((state) => state.laden);
  const zetIngeschakeld = useExtensieStore((state) => state.zetIngeschakeld);
  const koppelMap = useExtensieStore((state) => state.koppelMap);
  const ontkoppel = useExtensieStore((state) => state.ontkoppel);
  const installeerZip = useExtensieStore((state) => state.installeerZip);
  const verwijder = useExtensieStore((state) => state.verwijder);
  const [zoektekst, setZoektekst] = useState("");
  const [actieFout, setActieFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => { void laden(); }, [laden]);

  async function voerUit(actie: () => Promise<void>) {
    setBezig(true);
    setActieFout(null);
    try { await actie(); }
    catch (fout) { setActieFout(fout instanceof Error ? fout.message : String(fout)); }
    finally { setBezig(false); }
  }

  async function kiesZip() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const pad = await open({ multiple: false, filters: [{ name: "ZIP", extensions: ["zip"] }] });
    if (!pad || Array.isArray(pad) || !window.confirm(t("extensionManager.trustWarning"))) return;
    await installeerZip(pad);
  }

  async function kiesMap() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const map = await open({ directory: true, multiple: false });
    if (!map || Array.isArray(map) || !window.confirm(t("extensionManager.trustWarning"))) return;
    await koppelMap(map);
  }

  const zichtbaar = kaarten.filter((kaart) => {
    const tekst = `${kaart.manifest?.name ?? ""} ${kaart.manifest?.description ?? ""} ${kaart.map}`.toLocaleLowerCase();
    return tekst.includes(zoektekst.toLocaleLowerCase());
  });

  return (
    <div className="ext-manager">
      <h2 className="ext-manager-title">{t("extensions")}</h2>
      <p className="ext-manager-hint">{t("extensionManager.intro")}</p>
      <div className="ext-search-row">
        <input type="search" className="ext-search" value={zoektekst}
          placeholder={t("extSearchPlaceholder")} onChange={(event) => setZoektekst(event.target.value)} />
        <button className="ext-upload-btn" disabled={bezig} onClick={() => { void voerUit(kiesZip); }}>+ ZIP</button>
        <button className="ext-upload-btn" disabled={bezig} onClick={() => { void voerUit(kiesMap); }}>
          {t("extensionManager.linkFolder")}
        </button>
        <button className="ext-upload-btn" disabled={bezig} onClick={() => { void voerUit(laden); }}>
          {t("extensionManager.reload")}
        </button>
      </div>
      {(actieFout || laadfout) && <p className="ext-error" role="alert">{actieFout || laadfout}</p>}
      {zichtbaar.length === 0 && !actieFout && !laadfout &&
        <p className="ext-manager-hint">{t("extensionManager.empty")}</p>}
      <div className="ext-list">
        {zichtbaar.map((kaart) => {
          const manifest = kaart.manifest;
          return (
            <div key={kaart.map} className={`ext-card${kaart.ingeschakeld ? "" : " disabled"}`}>
              <div className="ext-card-header">
                <span className="ext-category-badge">{manifest?.category || t("extensionManager.other")}</span>
                {manifest && <span className="ext-version">v{manifest.version}</span>}
              </div>
              <div className="ext-card-body">
                <strong className="ext-name">{manifest?.name || kaart.map.split(/[\\/]/).pop()}</strong>
                {manifest?.description && <p className="ext-desc">{manifest.description}</p>}
                <span className="ext-author">{manifest?.author || ""}</span>
                {manifest && <p className="ext-types">{manifest.importers.flatMap((importeur) => importeur.fileExtensions.map((ext) => `.${ext}`)).join(", ")}</p>}
                <p className="ext-path">{kaart.map}</p>
                {kaart.fout && <p className="ext-error" role="alert">{kaart.fout}</p>}
              </div>
              <div className="ext-card-actions">
                {manifest && <label className="ext-enabled-label">
                  <input type="checkbox" checked={kaart.ingeschakeld} disabled={bezig}
                    onChange={(event) => { void voerUit(() => zetIngeschakeld(manifest.id, event.target.checked)); }} />
                  {t("extensionManager.enabled")}
                </label>}
                {kaart.bron !== "omgeving" && <button className="ext-install-btn" disabled={bezig}
                  onClick={() => { void voerUit(() => kaart.bron === "gekoppeld" ? ontkoppel(kaart.map) : verwijder(kaart.map)); }}>
                  {t(kaart.bron === "gekoppeld" ? "extensionManager.unlink" : "extensionManager.remove")}
                </button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
