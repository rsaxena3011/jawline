/**
 * The receipt screen, shared by fixture mode and live mode. It
 * renders only the receipt view model (lib/ui/receipt-view.ts),
 * which itself only copies engine output: no verdict, distance,
 * margin or threshold is computed in this component or below it.
 */

import type { ReceiptView } from "../../lib/ui/receipt-view.ts";

export default function ReceiptSection({
  view,
  rankingHeading,
}: {
  view: ReceiptView;
  rankingHeading: string;
}) {
  return (
    <section className="receipt" aria-label="Decision receipt">
      <p className="fixture-banner">{view.fixtureLabel}</p>
      <p className="verdict-line">
        <span className="verdict-chip">{view.verdict}</span>
      </p>
      <h2 className="receipt-headline">{view.headline}</h2>
      <p className="reason-tag">Reason: {view.reasonTag}</p>
      <p>{view.measuredToneText}</p>

      <h3>Thresholds the engine applied</h3>
      <dl className="thresholds">
        {view.thresholdRows.map((row) => (
          <div key={row.label} className="threshold-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {view.rankingRows.length > 0 ? (
        <>
          <h3>{rankingHeading}</h3>
          <table className="ranking">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Shade</th>
                <th scope="col">Hex</th>
                <th scope="col">Distance (CIEDE2000)</th>
              </tr>
            </thead>
            <tbody>
              {view.rankingRows.map((row) => (
                <tr key={row.position}>
                  <td>{row.position}</td>
                  <td>{row.shadeLabel}</td>
                  <td>
                    <span
                      className="swatch swatch-small"
                      style={{ backgroundColor: row.hex }}
                      aria-hidden="true"
                    />{" "}
                    {row.hex}
                  </td>
                  <td>{row.distanceText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {view.ownedText !== null ? <p>{view.ownedText}</p> : null}

      <h3>Planner log</h3>
      <ol className="planner">
        {view.plannerRows.map((row) => (
          <li key={row.step}>
            <strong>{row.step}</strong> [{row.outcome}] {row.unitsText}
            <br />
            {row.why}
          </li>
        ))}
      </ol>
      <p className="units-total">{view.unitsSpentText}</p>
    </section>
  );
}
