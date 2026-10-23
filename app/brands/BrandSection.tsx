/**
 * The aggregate brand screen. It renders only the brand view model
 * (lib/ui/brand-view.ts), which itself only counts the receipts
 * runDecision produced over the six study tones: no verdict, count
 * or share is computed in this component or below it.
 */

import type { BrandView } from "../../lib/ui/brand-view.ts";

export default function BrandSection({ view }: { view: BrandView }) {
  return (
    <section className="receipt" aria-label="Catalog coverage across the study set">
      <h2>Coverage gap</h2>
      <p className="receipt-headline">{view.coverageGapLine}.</p>
      <p>{view.gapBreakdownLine}</p>

      <h3>Verdicts across the six study tones</h3>
      <table className="ranking">
        <thead>
          <tr>
            <th scope="col">Verdict</th>
            <th scope="col">Share of study tones</th>
            <th scope="col">Which tones</th>
          </tr>
        </thead>
        <tbody>
          {view.verdictRows.map((row) => (
            <tr key={row.verdict}>
              <td>
                <span className="verdict-chip">{row.verdict}</span>
              </td>
              <td>{row.shareText}</td>
              <td>{row.toneListText}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Every tone, every receipt</h3>
      <table className="ranking">
        <thead>
          <tr>
            <th scope="col">Tone</th>
            <th scope="col">Reading (skin_color)</th>
            <th scope="col">Face pixels (study truth)</th>
            <th scope="col">Verdict</th>
            <th scope="col">Receipt headline</th>
          </tr>
        </thead>
        <tbody>
          {view.perTone.map((row) => (
            <tr key={row.toneId}>
              <td>
                {row.toneId} ({row.label})
              </td>
              <td>
                <span
                  className="swatch swatch-small"
                  style={{ backgroundColor: row.readingHex }}
                  aria-hidden="true"
                />{" "}
                {row.readingHex}
              </td>
              <td>
                <span
                  className="swatch swatch-small"
                  style={{ backgroundColor: row.pixelHex }}
                  aria-hidden="true"
                />{" "}
                {row.pixelHex}
              </td>
              <td>
                <span className="verdict-chip">{row.verdict}</span>
                <br />
                <span className="reason-tag">{row.reasonTag}</span>
              </td>
              <td>{row.headline}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>What this screen is</h3>
      <ul>
        {view.honestyLines.map((line) => (
          <li key={line.slice(0, 24)}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
