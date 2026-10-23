# ShadeVeto

Check foundation against your face and the bottles you already own
before you buy. It tells you when it can't tell.

ShadeVeto is a purchase-decision engine for one foundation, built on
the YouCam API for the YouCam API Skin AI & eCommerce VTO Hackathon
(Devpost, deadline Nov 2, 2026). It is not another shade finder: the
product is the receipt, a BUY, SHADE-RISK, or NO verdict whose every
reason traces to a measurement, including DON'T BUY when you already
own the match.

## How it works

1. **Capture.** A guided photo (lighting, pose, face size) with a
   colour-cast warning, before any paid API call happens. The photo
   is shrunk on the device, uploaded once, and its file id is reused
   by every task.
2. **Colour.** One Skin Tone call returns a skin colour. Candidates
   come from a small, dated, licensed shade catalog and are ranked by
   CIEDE2000 colour distance.
3. **Preview.** The top candidates are rendered with Makeup VTO
   (smoothing explicitly off, settings fixed across shades) so the
   shopper can look at the blend. The render is a labelled preview
   only: it never feeds the verdict. (An earlier plan measured the
   blend at the jawline and ranked by it; that metric failed its
   validation study in October 2026 and was cut.)
4. **Planner.** A 4-concern Skin Analysis is spent only when it could
   change the verdict (a borderline colour read, a formula-risk
   flag). It logs what it spent, skipped, and why.
5. **Receipt.** BUY / SHADE-RISK / NO (already own it; mix two owned
   bottles; no shade in range blends; evidence too weak). If a number
   is missing, the reason falls back to a fixed template instead of
   inventing precision.

## Status

Build slices 1 to 6 landed (Oct 22 to 23, 2026): the decision engine
(CIEDE2000 ranking, owned-bottle check first, cluster rule), the
receipt UI, live mode behind the judge passcode with server-side
spend caps (one verified live Skin Tone call: balance 887 to 867,
exactly the 20-unit cost), the brand coverage screen, and the
licensed 617-shade Pudding catalog (MIT) as the live ranking target.
207 checks green. Remaining before submission: final polish, the
demo video, and the Devpost filing (deadline Nov 2, 2026). The
product was renamed from its working name Jawline to ShadeVeto on
Oct 23, 2026; the day-1 probe checklist below is kept as the
historical record of that probe.

## Setup

```sh
npm install
cp .env.example .env.local   # then fill it in, see below
npm run dev
```

### Environment variables

| Variable | What it is | Where it comes from |
| --- | --- | --- |
| `YOUCAM_API_KEY` | Server-side API key. Never exposed to the browser, never committed. | The YouCam console for the India region, https://yce.makeupar.com (sign in, then the API key section of the account). The 1,000 hackathon units were redeemed on this account. |
| `YOUCAM_API_BASE_URL` | API host. Default `https://yce-api-01.makeupar.com` is UNVERIFIED; a perfectcorp.com host is the other candidate the probe checks. | Confirmed by the day-1 probe. |
| `JUDGE_PASSCODE` | Unlocks judge mode (live calls, may spend the reserve). Without it everyone is public and gets replays only. | Invent a value; set it here and in the deployment's env settings. |

For the Vercel deployment, set the same three variables in the
project's environment settings. There is no key in this repo, by
design.

## Scripts

- `npm run dev` / `npm run build` / `npm start`: the Next.js app.
- `npm test`: the full suite (client, ledger, catalog, fixtures),
  plain Node test files with PASS/FAIL output, mirroring the sibling
  project convention.

## Layout

- `app/`: landing page, layout, `/api/health`.
- `lib/config.ts`: every cost, path, and host in one place, marked
  UNVERIFIED until the probe settles it.
- `lib/youcam/`: API client (two-step upload, task create + poll,
  typed results). Task creation is never auto-retried: a slow server
  plus a retry can create two tasks and charge twice.
- `lib/ledger/`: unit ledger (reserve at task start, settle on
  completion, balance via a provider interface; the real provider is
  wired after the probe, the stub returns "unknown") and the
  judge/public access split.
- `lib/catalog/`: shade schema and loader. Provenance is enforced:
  no source, no entry.
- `lib/fixtures/` and `fixtures/`: result-image mirroring and the
  fixtures convention (result URLs expire, so images are mirrored at
  capture time).

## Unit budget (UNVERIFIED working figures)

Skin Tone 20 per call, Skin Analysis SD 9 (1-4 concerns) or 12
(5-8), Makeup VTO 1 per render: roughly 30-36 units per full live
run. Of the 1,000 granted units, about 240 are earmarked for the
measurement study, about 460 for build and video, and 300 are held
untouched as the judging reserve, spendable only in judge mode.
Every figure here is a working number from planning, to be confirmed
in the console during the probe; the ledger reads the real balance
through its provider interface rather than trusting this table.

## Day-1 probe checklist (before any UI work)

From the India-region account, end to end on one real photo:

- [ ] Confirm the redeemed units' expiry date passes Nov 20, 2026.
- [ ] Two-step upload works (ticket, presigned PUT, file id).
- [ ] Skin Tone response schema; confirm there is no undertone field.
- [ ] Makeup VTO accepts an arbitrary foundation hex; check the
      smoothing default (expected 50, must be set to 0 explicitly).
- [ ] Skin Analysis SD field list at 4 concerns.
- [ ] True per-call unit costs from the console, and the real balance
      endpoint (wire it into the ledger's BalanceProvider).
- [ ] Which API host this key works on (settle YOUCAM_API_BASE_URL).
- [ ] Result/file retention window (settle the fixtures rule).
- [ ] Camera Kit shadefinder mode loads on the deployed site.

GO/NO-GO: if custom foundation VTO or a usable skin-colour output
fails on the real account, the product core is reassessed the same
day, not at the deadline.

## License

MIT.
