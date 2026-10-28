import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StructuralGrid, GridAxisLine } from "../fem/femTypes";

type Plane = "xy" | "xz" | "yz";
export interface EnvelopeGridChoice { plane: Plane; fixed: number; first: [number, number]; second: [number, number] }

export default function OpenFem3DEnvelopeGridPanel({ grid, onCreate }: {
  grid: StructuralGrid; onCreate: (choice: EnvelopeGridChoice) => void;
}) {
  const { t } = useTranslation("ribbon");
  const [plane, setPlane] = useState<Plane>("xy");
  const [fixed, setFixed] = useState(-1);
  const [a0, setA0] = useState(0), [a1, setA1] = useState(-1);
  const [b0, setB0] = useState(0), [b1, setB1] = useState(-1);
  const sorted = (lines: GridAxisLine[]) => [...lines].sort((a, b) => a.position - b.position);
  const [first, second, constant] = plane === "xy"
    ? [sorted(grid.xAxes), sorted(grid.yAxes ?? []), sorted(grid.zAxes)]
    : plane === "xz"
      ? [sorted(grid.xAxes), sorted(grid.zAxes), sorted(grid.yAxes ?? [])]
      : [sorted(grid.yAxes ?? []), sorted(grid.zAxes), sorted(grid.xAxes)];
  const last = (value: number, lines: GridAxisLine[]) => value < 0 ? lines.length - 1 : Math.min(value, lines.length - 1);
  const choice = (lines: GridAxisLine[], value: number, set: (index: number) => void, label: string) =>
    <label>{label}<select value={last(value, lines)} onChange={(event) => set(Number(event.target.value))}>
      {lines.map((axis, index) => <option key={axis.id} value={index}>{axis.label}</option>)}
    </select></label>;
  const ready = first.length >= 2 && second.length >= 2 && constant.length >= 1;
  return <div className="open-fem3d-envelope-grid">
    <strong>{t("openFem3d.envelopeGrid.title")}</strong>
    <label>{t("openFem3d.envelopeGrid.plane")}
      <select value={plane} onChange={(event) => {
        const next = event.target.value as Plane;
        setPlane(next); setFixed(next === "xy" ? -1 : 0); setA0(0); setA1(-1); setB0(0); setB1(-1);
      }}>
        <option value="xy">{t("openFem3d.envelopeGrid.roof")}</option>
        <option value="xz">{t("openFem3d.envelopeGrid.facadeY")}</option>
        <option value="yz">{t("openFem3d.envelopeGrid.facadeX")}</option>
      </select>
    </label>
    {ready ? <>
      {choice(constant, fixed, setFixed, t("openFem3d.envelopeGrid.fixed"))}
      {choice(first, a0, setA0, t("openFem3d.envelopeGrid.from"))}
      {choice(first, a1, setA1, t("openFem3d.envelopeGrid.to"))}
      {choice(second, b0, setB0, t("openFem3d.envelopeGrid.from"))}
      {choice(second, b1, setB1, t("openFem3d.envelopeGrid.to"))}
      <button type="button" onClick={() => onCreate({
        plane, fixed: constant[last(fixed, constant)].position / 1000,
        first: [first[last(a0, first)].position / 1000, first[last(a1, first)].position / 1000],
        second: [second[last(b0, second)].position / 1000, second[last(b1, second)].position / 1000],
      })}>{t("openFem3d.envelopeGrid.create")}</button>
    </> : <span>{t("openFem3d.envelopeGrid.missing")}</span>}
  </div>;
}
