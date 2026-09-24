import { Injectable } from '@nestjs/common';

/**
 * Local sandbox payment provider.
 *
 * It exists so the whole permit → payment → activation lifecycle can be
 * exercised end-to-end without Campay credentials. It is deliberately *not* a
 * fake Campay: no payment ever becomes SUCCESSFUL here by itself. A payment
 * stays PENDING until an authorised officer confirms the outcome through the
 * clearly-labelled sandbox endpoint (`POST /payments/:id/simulate`), and every
 * row created this way carries `isDemo`/`SIMULATOR` markers so it can never be
 * mistaken for a real settlement.
 */
@Injectable()
export class SimulatorProvider {
  readonly kind = 'SIMULATOR' as const;

  readonly instructions =
    'Sandbox provider: no money moves. An administrator with payments:verify confirms the outcome via POST /payments/:id/simulate. ' +
    'Set PAYMENT_PROVIDER=campay together with CAMPAY_* credentials to use the real mobile-money provider.';

  acknowledge(reference: string): { providerReference: string; payload: Record<string, unknown> } {
    return {
      providerReference: `SIM-${reference}`,
      payload: {
        sandbox: true,
        provider: 'SIMULATOR',
        note: this.instructions,
        receivedAt: new Date().toISOString(),
      },
    };
  }
}
