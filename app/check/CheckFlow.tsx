"use client";

/**
 * The fixture-mode check flow: capture screen, owned-bottle entry,
 * receipt screen. This component holds selections and renders
 * results. It computes no verdict, distance, margin or threshold:
 * the gate verdict comes from checkCapture, the receipt from
 * runDecision, and every string on the receipt screen comes from
 * buildReceiptView over that receipt.
 */

import { useState } from "react";
import { checkCapture } from "../../lib/decision/capture.ts";
import {
  runDecision,
  type Receipt,
} from "../../lib/decision/decision.ts";
import { STUDY_TONES } from "../../lib/decision/fixtures.ts";
import {
  FIXTURE_FRAMINGS,
  buildFixtureInput,
  faceShareText,
  fixtureFraming,
} from "../../lib/ui/fixture-session.ts";
import { buildReceiptView } from "../../lib/ui/receipt-view.ts";

export default function CheckFlow() {
  const [toneId, setToneId] = useState<string>("tone2");
  const [framingId, setFramingId] = useState<string>("study-crop");
  const [ownedHex, setOwnedHex] = useState<string>("");
  const [ownedName, setOwnedName] = useState<string>("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const framing = fixtureFraming(framingId);
  const gate = checkCapture(framing.measurement);
  const view = receipt !== null ? buildReceiptView(receipt) : null;

  function run() {
    const built = buildFixtureInput({ toneId, framingId, ownedHex, ownedName });
    if ("error" in built) {
      setError(built.error);
      setReceipt(null);
      return;
    }
    setError(null);
    setReceipt(runDecision(built.input));
  }

  return (
    <div className="check-flow">
      <fieldset className="step">
        <legend>1. Pick a study face (fixture data)</legend>
        <div className="tone-grid">
          {STUDY_TONES.map((tone) => (
            <label key={tone.id} className="tone-option">
              <input
                type="radio"
                name="tone"
                value={tone.id}
                checked={toneId === tone.id}
                onChange={() => setToneId(tone.id)}
              />
              <span
                className="swatch"
                style={{ backgroundColor: tone.result.skinColorHex }}
                aria-hidden="true"
              />
              <span className="tone-text">
                <strong>
                  {tone.id}: {tone.label}
                </strong>
                <span>Reading (skin_color): {tone.result.skinColorHex}</span>
                <span>Face pixels, study ground truth: {tone.pixelHex}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="step">
        <legend>2. Choose the photo framing</legend>
        <div className="framing-list">
          {FIXTURE_FRAMINGS.map((option) => (
            <label key={option.id} className="framing-option">
              <input
                type="radio"
                name="framing"
                value={option.id}
                checked={framingId === option.id}
                onChange={() => setFramingId(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="face-share">{faceShareText(framing.measurement)}</p>
        {gate.ok ? (
          <p className="gate-ok">
            Capture gate: no framing problems found. The receipt will
            show the gate&apos;s own line for this photo.
          </p>
        ) : (
          <div className="gate-alert" role="alert">
            <p>
              <strong>Capture gate: this photo is rejected.</strong>
            </p>
            <ul>
              {gate.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>
              You can still run the check: the engine will answer
              CAN&apos;T TELL and spend nothing.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="step">
        <legend>3. A bottle you already own (optional)</legend>
        <p className="step-note">
          The owned-bottle check runs first and costs nothing. If a
          bottle on your shelf already matches the measured tone, the
          answer is Don&apos;t buy.
        </p>
        <div className="owned-fields">
          <label>
            Shade hex
            <input
              type="text"
              value={ownedHex}
              onChange={(event) => setOwnedHex(event.target.value)}
              placeholder="#A77D60"
              inputMode="text"
            />
          </label>
          <label>
            Bottle name (optional)
            <input
              type="text"
              value={ownedName}
              onChange={(event) => setOwnedName(event.target.value)}
              placeholder="My current foundation"
            />
          </label>
          {ownedHex.trim().length > 0 ? (
            <span
              className="swatch"
              style={{ backgroundColor: ownedHex.trim() }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </fieldset>

      <button type="button" className="run-button" onClick={run}>
        Run the check
      </button>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {view !== null ? (
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
              <h3>Full ranking, closest first (fixture catalog)</h3>
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
      ) : null}
    </div>
  );
}
