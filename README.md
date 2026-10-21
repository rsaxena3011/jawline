# Jawline

Check foundation against your face and the bottles you already own
before you buy. It tells you when it can't tell.

Jawline is a purchase-decision engine for one foundation, built on
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
3. **Jawline test.** The top candidates are rendered with Makeup VTO
   (smoothing explicitly off, settings fixed across shades), and the
   blend where jaw meets bare neck is measured. The shade whose
   jawline disappears ranks first. The render may disagree with the
   colour ranking; disagreement is itself a verdict input.
4. **Planner.** A 4-concern Skin Analysis is spent only when it could
   change the verdict (a borderline colour read, a formula-risk
   flag). It logs what it spent, skipped, and why.
5. **Receipt.** BUY / SHADE-RISK / NO (already own it; mix two owned
   bottles; no shade in range blends; evidence too weak). If a number
   is missing, the reason falls back to a fixed template instead of
   inventing precision.

## Status

Phase 1 scaffold (Oct 21, 2026). Landed: app shell, landing page,
`/api/health`, the server-side YouCam client skeleton, the unit
ledger with the judge/public split, the shade catalog schema and
loader, and the fixture mirroring plumbing, all with tests. **No live
YouCam API calls are made yet.** The day-1 probe (below) is the first
live use, and several figures in `lib/config.ts` are marked
UNVERIFIED until it runs.

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
