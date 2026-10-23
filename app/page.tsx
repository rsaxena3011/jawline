export default function HomePage() {
  return (
    <div className="landing">
      <section className="hero">
        <h1>Jawline</h1>
        <p className="one-liner">
          Check foundation against your face and the bottles you already
          own before you buy. It tells you when it can&apos;t tell.
        </p>
        <p className="hero-sub">
          One foundation, checked three ways: its colour against your
          skin, its blend at the jawline in a try-on render, and your
          shelf, so the answer can be BUY, SHADE-RISK, or NO, with the
          reason shown. Built on the YouCam API.
        </p>
      </section>

      <section id="how" className="how">
        <h2>How it works</h2>
        <ol>
          <li>
            <strong>Capture.</strong> A guided photo with lighting and
            framing checks, plus a colour-cast warning, before any paid
            API call happens.
          </li>
          <li>
            <strong>Colour.</strong> One skin-tone reading, ranked
            against a small, dated, licensed shade catalog by colour
            distance.
          </li>
          <li>
            <strong>Jawline test.</strong> The top shades are rendered
            on your photo, and the blend where jaw meets bare neck is
            measured. The shade whose jawline disappears ranks first.
          </li>
          <li>
            <strong>Receipt.</strong> BUY, SHADE-RISK, or NO, with
            every number in the reason traced to a measurement, and a
            DON&apos;T BUY when you already own the match.
          </li>
        </ol>
      </section>

      <section className="status">
        <h2>Status</h2>
        <p>
          Build in progress: the decision engine and its fixture-mode
          check page are in, and live mode now runs behind the judge
          passcode on the same page: one real Skin Tone call through
          the same engine, under server-side spend caps, with a
          receipt labelled LIVE. Public visitors get the fixture
          replay only. A brand coverage screen now counts the same
          engine&apos;s verdicts across all six study tones, so a
          catalog&apos;s gaps show as plain counts, one bucket per
          verdict, never merged.
        </p>
      </section>
    </div>
  );
}
