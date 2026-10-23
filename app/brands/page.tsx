import { licensedCatalog } from "../../lib/catalog/licensed.ts";
import { computeBrandView } from "../../lib/ui/brand-view.ts";
import BrandSection from "./BrandSection";

export default function BrandsPage() {
  const catalog = licensedCatalog();
  const view = computeBrandView(catalog);
  return (
    <div className="check">
      <section className="check-head">
        <h1>Catalog coverage, brand view</h1>
        <p className="fixture-banner" role="note">
          Study data only: this screen counts the decision
          engine&apos;s verdicts over the six synthetic study tones,
          ranked against the licensed catalog: {catalog.shades.length}{" "}
          real foundation shades from The Pudding foundation shades
          dataset, swatches recorded in 2018, used under the MIT
          License. No API call is made and no units are spent. It is
          a coverage report on a small test set, not a claim about
          shoppers in general.
        </p>
        <p>
          A shopper-facing check answers one person. This screen
          answers the brand: if faces like the six study tones came
          to this catalog, how many would leave with a shade the
          engine can stand behind, and for the rest, exactly why not?
          Every figure below traces to a receipt the engine produced
          in this same computation, one per tone, listed in full.
        </p>
      </section>
      <BrandSection view={view} />
    </div>
  );
}
