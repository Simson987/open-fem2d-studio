import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openFem3DConnectSkipPart, type OpenFem3DConnectSkip, type OpenFem3DNodeOnBeam } from "./openFem3dAansluiten";
import type { OpenFem3DLevel } from "./openFem3dLevels";
import {
  openFem3DMergeGroupPart, openFem3DMergeRefusalPart, type OpenFem3DCoincidentGroup, type OpenFem3DMergeMessagePart,
  type OpenFem3DMergeRefusal,
} from "./openFem3dSamenvoegen";

/** Zoveel regels toont de lijst; de rest als "… en nog n". */
const REGELS = 50;

interface Props {
  /** De knopen die op een staaf liggen zonder verbinding (openFem3DConnectCheck). */
  findings: readonly OpenFem3DNodeOnBeam[];
  /** De paren die Aansluiten niet kan aansluiten, met de reden (openFem3DConnectCheck). */
  skipped?: readonly OpenFem3DConnectSkip[];
  /** Hoeveel paren Aansluiten wel aansluit; 0 zet de knop uit. Zonder: de knop staat aan. */
  connectable?: number;
  /** De verbindingstolerantie in mm, voor de uitleg bij de knoppen. */
  toleranceMm: number;
  /** Aansluiten in het hele model (één stap ongedaan maken). */
  onConnect: () => void;
  /** De groepen samenvallende knopen (openFem3DMergeCheck, issue #75). */
  mergeGroups?: readonly OpenFem3DCoincidentGroup[];
  /** De groepen die Samenvoegen niet kan samenvoegen, met de reden (openFem3DMergeCheck). */
  mergeRefused?: readonly OpenFem3DMergeRefusal[];
  /** Hoeveel knopen Samenvoegen laat verdwijnen; 0 zet de knop uit. Zonder: de knop staat aan. */
  mergeable?: number;
  /** Samenvoegen in het hele model (één stap ongedaan maken). */
  onMerge?: () => void;
  /** De levels van het stramien: een weigering om levels noemt ze bij naam en hoogte in plaats van hun id. */
  levels?: readonly OpenFem3DLevel[];
  /** Elke nieuwe waarde klapt de lijst open (Berekenen met losse knopen). */
  openToken?: number;
}

/**
 * Modelcontrole van het 3D-tekenvlak. Twee soorten bevindingen, elk met een
 * eigen kopregel en knop, in één lijst:
 *  - issue #63: een knoop die op een staaf ligt maar er niet aan vastzit
 *    ("Knoop 12 ligt op staaf 7 maar is niet verbonden."), met de knop
 *    Aansluiten die de staven op al die knopen splitst;
 *  - issue #75: knopen die binnen de verbindingstolerantie samenvallen
 *    ("Knoop 12 valt samen met knoop 5 (3 mm)."), met de knop Samenvoegen.
 * Live met het model, net als de modelcontrole in 2D; zo staan ze er ook
 * direct na het openen van een oud project, zonder dat het model stil
 * verandert. Wat een knop niet kan (overlappende staven, een groep breder dan
 * 2 × de tolerantie, verschillende levels …) krijgt zijn reden in de regel,
 * dezelfde regel als in de melding na de knop; kan een knop niets, dan staat
 * hij uit, met de uitleg waarom. Geen bevindingen: niets in beeld.
 */
export default function OpenFem3DModelCheck({
  findings, skipped = [], connectable, toleranceMm, onConnect,
  mergeGroups = [], mergeRefused = [], mergeable, onMerge, levels = [], openToken = 0,
}: Props) {
  const { t } = useTranslation("ribbon");
  const [open, setOpen] = useState(true);
  const aantal = findings.length + mergeGroups.length;
  const knopen = new Set(findings.map((finding) => finding.nodeId)).size;
  const samenvallend = mergeGroups.reduce((som, groep) => som + groep.nodeIds.length - 1, 0);
  // Nieuwe bevindingen (van niets naar iets): de lijst klapt open, zoals in 2D.
  const hadFindings = useRef(aantal > 0);
  useEffect(() => {
    if (aantal > 0 && !hadFindings.current) setOpen(true);
    hadFindings.current = aantal > 0;
  }, [aantal]);
  const laatsteToken = useRef(openToken);
  useEffect(() => {
    if (openToken === laatsteToken.current) return;
    laatsteToken.current = openToken;
    setOpen(true);
  }, [openToken]);
  if (aantal === 0) return null;
  const mm = String(Math.round(toleranceMm * 100) / 100);
  const reden = new Map(skipped.map((skip) => [`${skip.nodeId}:${skip.beamId}`, skip]));
  const weigering = new Map(mergeRefused.map((refusal) => [refusal.nodeIds.join(","), refusal]));
  const niets = connectable === 0;
  const nietsSamen = mergeable === 0;
  // Een regel uit een melding, met de lijsten (eigenschappen van staven) vertaald.
  const tekst = (part: OpenFem3DMergeMessagePart) => t(part.key, {
    ...(part.values ?? {}),
    ...(part.count === undefined ? {} : { count: part.count }),
    ...Object.fromEntries(Object.entries(part.lists ?? {}).map(([naam, sleutels]) => [naam, sleutels.map((s) => t(s)).join(", ")])),
  });
  const chevron = <span className="open-fem3d-model-check-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>;
  const merk = <span className="open-fem3d-model-check-merk" aria-hidden="true">!</span>;
  // De bovenste kopregel klapt de lijst in en uit; de tweede (als beide soorten er zijn) is alleen een titel.
  const aansluitTitel = t("openFem3d.modelCheck.title", { count: knopen });
  const samenTitel = t("openFem3d.modelCheck.mergeHeading", { count: samenvallend });
  const regels = [
    ...findings.map((finding) => ({ soort: "aansluiten" as const, finding })),
    ...mergeGroups.map((groep) => ({ soort: "samenvoegen" as const, groep })),
  ];
  return (
    <div className="open-fem3d-model-check" role="status" data-open-fem3d-model-check={findings.length}
      data-open-fem3d-merge-check={mergeGroups.length}>
      <div className="open-fem3d-model-check-kop">
        <button type="button" className="open-fem3d-model-check-toggle" aria-expanded={open}
          title={t("openFem3d.modelCheck.toggleTitle")} onClick={() => setOpen((value) => !value)}>
          {merk}
          <span>{findings.length > 0 ? aansluitTitel : samenTitel}</span>
          {chevron}
        </button>
        {findings.length > 0 ? (
          <button type="button" className="open-fem3d-model-check-connect" data-open-fem3d-connect-nodes
            disabled={niets}
            title={!niets ? t("openFem3d.modelCheck.connectTitle", { mm }) : t("openFem3d.modelCheck.connectNothing")}
            onClick={onConnect}>
            {t("openFem3d.modelCheck.connect")}
          </button>
        ) : null}
        {findings.length === 0 && onMerge ? (
          <button type="button" className="open-fem3d-model-check-connect" data-open-fem3d-merge-nodes
            disabled={nietsSamen}
            title={!nietsSamen ? t("openFem3d.modelCheck.mergeTitle", { mm }) : t("openFem3d.modelCheck.mergeNothing")}
            onClick={onMerge}>
            {t("openFem3d.modelCheck.merge")}
          </button>
        ) : null}
      </div>
      {findings.length > 0 && mergeGroups.length > 0 && (
        <div className="open-fem3d-model-check-kop open-fem3d-model-check-kop-tweede">
          <span className="open-fem3d-model-check-titel">{merk}<span>{samenTitel}</span></span>
          {onMerge ? (
            <button type="button" className="open-fem3d-model-check-connect" data-open-fem3d-merge-nodes
              disabled={nietsSamen}
              title={!nietsSamen ? t("openFem3d.modelCheck.mergeTitle", { mm }) : t("openFem3d.modelCheck.mergeNothing")}
              onClick={onMerge}>
              {t("openFem3d.modelCheck.merge")}
            </button>
          ) : null}
        </div>
      )}
      {open && (
        <ul className="open-fem3d-model-check-lijst">
          {regels.slice(0, REGELS).map((regel) => {
            if (regel.soort === "aansluiten") {
              const { finding } = regel;
              const skip = reden.get(`${finding.nodeId}:${finding.beamId}`);
              const part = skip ? openFem3DConnectSkipPart(skip) : null;
              return (
                <li key={`${finding.nodeId}:${finding.beamId}`} data-node={finding.nodeId} data-beam={finding.beamId}
                  {...(skip ? { "data-reden": skip.reason } : {})}>
                  {part ? t(part.key, part.values) : t("openFem3d.modelCheck.nodeOnBeam", { node: finding.nodeId, beam: finding.beamId })}
                </li>
              );
            }
            const { groep } = regel;
            const geweigerd = weigering.get(groep.nodeIds.join(","));
            return (
              <li key={`samen:${groep.nodeIds.join(",")}`} data-merge-nodes={groep.nodeIds.join(",")} data-merge-keep={groep.keepNodeId}
                {...(geweigerd ? { "data-reden": geweigerd.reason.kind } : {})}>
                {tekst(geweigerd ? openFem3DMergeRefusalPart(geweigerd, levels) : openFem3DMergeGroupPart(groep))}
              </li>
            );
          })}
          {regels.length > REGELS && (
            <li className="open-fem3d-model-check-meer">{t("openFem3d.modelCheck.more", { count: regels.length - REGELS })}</li>
          )}
        </ul>
      )}
    </div>
  );
}
