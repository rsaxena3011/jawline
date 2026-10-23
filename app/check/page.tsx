import CheckFlow from "./CheckFlow";

export default function CheckPage() {
  return (
    <div className="check">
      <section className="check-head">
        <h1>Check a foundation</h1>
        <p className="fixture-banner" role="note">
          Fixture mode: this demo runs on recorded study data, not a
          live photo of you. No API call is made and no units are
          spent. Every face, shade and number on this page is labelled
          demo data, and the receipt below says so again.
        </p>
        <p>
          Pick one of the six study faces, choose how the photo is
          framed, and optionally list a foundation bottle you already
          own. The engine then checks the framing, checks your shelf
          first, ranks the fixture catalog by colour distance, and
          prints a receipt: BUY, SHADE-RISK, NO, or CAN&apos;T TELL,
          with its working shown.
        </p>
      </section>
      <CheckFlow />
    </div>
  );
}
