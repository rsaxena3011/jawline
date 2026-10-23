/**
 * The real BalanceProvider for live mode: reads the provider's own
 * unit endpoint through the YouCam client (see getUnitBalance in
 * lib/youcam/client.ts). This replaces the phase-1 stub for live
 * runs; the stub still exists for contexts that must not call out.
 * A failed read yields null, which the runner treats as "balance
 * unknown" and settles at the verified per-call cost instead.
 */

import {
  getUnitBalance,
  type YouCamClient,
} from "../youcam/client.ts";
import type { BalanceProvider } from "../ledger/ledger.ts";

export class UnitInfoBalanceProvider implements BalanceProvider {
  private readonly client: YouCamClient;

  constructor(client: YouCamClient) {
    this.client = client;
  }

  async getBalanceUnits(): Promise<number | null> {
    return getUnitBalance(this.client);
  }
}
