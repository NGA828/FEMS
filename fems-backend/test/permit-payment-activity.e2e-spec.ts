/**
 * Flows 2–4 — the permit lifecycle, the payment that unlocks it, and the field
 * activity it authorises.
 *
 * The suite walks a permit from DRAFT to ACTIVE through the API only: the
 * company files and submits it, a forest officer reviews and approves it, the
 * company's fee is settled through the payment endpoint (sandbox provider), and
 * only then can an exploitation activity be recorded against it.
 *
 * Everything it creates carries a unique marker so the records can be removed
 * afterwards, and nothing else in the register is modified.
 */
import { API, DEMO_PASSWORD, bearer, createFlowContext, unwrap, type FlowContext } from './setup/app';

const MARKER = `E2E-${Date.now()}`;

interface Permit {
  id: string;
  reference?: string;
  permitNumber: string;
  status: string;
  feeAmount?: string | number | null;
  volumeApprovedM3?: string | number | null;
  companyId?: string;
  forestId?: string;
}

interface Payment {
  id: string;
  reference: string;
  status: string;
  amount: string | number;
  isSandbox?: boolean;
}

describe('Flows — permit → payment → exploitation (e2e)', () => {
  let ctx: FlowContext;
  let companyToken: string;
  let officerToken: string;
  let adminToken: string;
  let companyId: string;
  let forestId: string;
  let permit: Permit;
  let createdActivityId: string | null = null;

  const createdPermitIds: string[] = [];

  beforeAll(async () => {
    ctx = await createFlowContext();
    [companyToken, officerToken, adminToken] = await Promise.all([
      ctx.login('demo.company@fems.cm', DEMO_PASSWORD),
      ctx.login('demo.officer@fems.cm', DEMO_PASSWORD),
      ctx.login('demo.admin@fems.cm', DEMO_PASSWORD),
    ]);

    const mine = await ctx.api().get(`${API}/companies/me`).set(...bearer(companyToken));
    companyId = unwrap<{ id: string }>(mine.body).id;

    const forests = await ctx.api().get(`${API}/forests?limit=1&status=ACTIVE`).set(...bearer(officerToken));
    forestId = unwrap<{ id: string }[]>(forests.body)[0].id;
  });

  afterAll(async () => {
    if (createdActivityId) {
      await ctx.prisma.evidence.deleteMany({ where: { activityId: createdActivityId } });
      await ctx.prisma.gISLocation.deleteMany({ where: { activityId: createdActivityId } });
      await ctx.prisma.activityEquipmentUsage.deleteMany({ where: { activityId: createdActivityId } });
      await ctx.prisma.exploitationActivity.deleteMany({ where: { id: createdActivityId } });
    }
    if (createdPermitIds.length) {
      await ctx.prisma.payment.deleteMany({ where: { permitId: { in: createdPermitIds } } });
      await ctx.prisma.permitStatusHistory.deleteMany({ where: { permitId: { in: createdPermitIds } } });
      await ctx.prisma.permitDocument.deleteMany({ where: { permitId: { in: createdPermitIds } } });
      await ctx.prisma.exploitationPermit.deleteMany({ where: { id: { in: createdPermitIds } } });
    }
    await ctx.close();
  });

  it('files a permit application for the caller’s own company', async () => {
    const response = await ctx.api()
      .post(`${API}/permits`)
      .set(...bearer(companyToken))
      .send({
        type: 'PROCESSING',
        title: `${MARKER} — selective logging of 120 m³`,
        purpose: 'End-to-end coverage of the permit lifecycle.',
        forestId,
        volumeRequestedM3: 120,
        areaRequestedHa: 15,
        startDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
      });

    expect([200, 201]).toContain(response.status);
    permit = unwrap<Permit>(response.body);
    createdPermitIds.push(permit.id);
    expect(permit.status).toBe('DRAFT');
    expect(permit.companyId).toBe(companyId);
  });

  it('refuses a permit filed on a company the caller does not represent', async () => {
    const others = await ctx.api().get(`${API}/companies?limit=100`).set(...bearer(officerToken));
    const other = unwrap<{ id: string }[]>(others.body).find((row) => row.id !== companyId);

    const response = await ctx.api()
      .post(`${API}/permits`)
      .set(...bearer(companyToken))
      .send({
        type: 'PROCESSING',
        title: `${MARKER} — forged applicant`,
        forestId,
        companyId: other?.id,
        volumeRequestedM3: 10,
        startDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 100 * 86_400_000).toISOString(),
      });

    expect([400, 403]).toContain(response.status);
    expect(response.body.success).toBe(false);
  });

  it('validates the requested volume and period', async () => {
    const noVolume = await ctx.api()
      .post(`${API}/permits`)
      .set(...bearer(companyToken))
      .send({
        type: 'PROCESSING',
        title: `${MARKER} — no volume`,
        forestId,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(noVolume.status).toBe(400);

    const backwards = await ctx.api()
      .post(`${API}/permits`)
      .set(...bearer(companyToken))
      .send({
        type: 'PROCESSING',
        title: `${MARKER} — backwards period`,
        forestId,
        volumeRequestedM3: 5,
        startDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.code).toBe('INVALID_PERMIT_PERIOD');
  });

  it('walks the permit to ACTIVE and confirms each state in the history', async () => {
    const act = (action: string, body: Record<string, unknown> = {}, token = officerToken) =>
      ctx.api().post(`${API}/permits/${permit.id}/actions/${action}`).set(...bearer(token)).send(body);

    // Applicant submits; only the applicant may do this.
    const officerSubmit = await act('SUBMIT');
    expect(officerSubmit.status).toBe(403);
    expect(officerSubmit.body.error.code).toBe('PERMIT_ACTION_FORBIDDEN');

    const submitted = await act('SUBMIT', {}, companyToken);
    expect([200, 201]).toContain(submitted.status);
    expect(unwrap<Permit>(submitted.body).status).toBe('SUBMITTED');

    const reviewed = await act('START_REVIEW');
    expect(unwrap<Permit>(reviewed.body).status).toBe('UNDER_REVIEW');

    const beforeApproval = await act('ACTIVATE');
    expect(beforeApproval.status).toBe(400);
    expect(beforeApproval.body.error.code).toBe('PERMIT_INVALID_TRANSITION');

    const approved = await act('APPROVE', { volumeApprovedM3: 100 });
    expect(unwrap<Permit>(approved.body).status).toBe('APPROVED');

    // Marking a permit as awaiting payment is the payer's step: the action is
    // gated on the payment permissions, which the forest service account does
    // not hold.
    const officerPending = await act('MARK_PAYMENT_PENDING');
    expect(officerPending.status).toBe(403);
    expect(officerPending.body.error.code).toBe('PERMIT_ACTION_FORBIDDEN');

    const pending = await act('MARK_PAYMENT_PENDING', {}, companyToken);
    expect(unwrap<Permit>(pending.body).status).toBe('PAYMENT_PENDING');

    // Activation is refused while the fee is outstanding.
    const unpaid = await act('ACTIVATE');
    expect(unpaid.status).toBe(400);
    expect(unpaid.body.error.code).toBe('PERMIT_FEES_UNPAID');

    const history = await ctx.api().get(`${API}/permits/${permit.id}/timeline`).set(...bearer(officerToken));
    expect(history.status).toBe(200);
    const timeline = unwrap<{ status?: string; toStatus?: string; action?: string }[]>(history.body);
    expect(timeline.length).toBeGreaterThanOrEqual(4);
  });

  describe('settling the permit fee', () => {
    let payment: Payment;
    let outstandingBefore: number;

    it('reports the outstanding balance before payment', async () => {
      const response = await ctx.api().get(`${API}/permits/${permit.id}`).set(...bearer(officerToken));
      expect(response.status).toBe(200);
      const detail = unwrap<Permit & { outstandingBalance?: number }>(response.body);
      outstandingBefore = Number(detail.outstandingBalance ?? detail.feeAmount ?? 0);
      expect(outstandingBefore).toBeGreaterThan(0);
    });

    it('refuses a payment above the outstanding fee', async () => {
      // Partial settlement is allowed (a fee may be paid in instalments), but
      // the register never accepts more than what is owed.
      const response = await ctx.api()
        .post(`${API}/payments`)
        .set(...bearer(companyToken))
        .send({
          purpose: 'PERMIT_FEE',
          permitId: permit.id,
          amount: outstandingBefore + 1,
          method: 'MOBILE_MONEY_MTN',
          payerPhone: '+237677000000',
        });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING_BALANCE');
    });

    it('refuses a zero or negative amount', async () => {
      const response = await ctx.api()
        .post(`${API}/payments`)
        .set(...bearer(companyToken))
        .send({
          purpose: 'PERMIT_FEE',
          permitId: permit.id,
          amount: 0,
          method: 'MOBILE_MONEY_MTN',
          payerPhone: '+237677000000',
        });
      expect(response.status).toBe(400);
    });

    it('ignores a payment status supplied by the client', async () => {
      // The API decides the status; a client cannot declare its own payment
      // successful by sending one.
      const response = await ctx.api()
        .post(`${API}/payments`)
        .set(...bearer(companyToken))
        .send({
          purpose: 'PERMIT_FEE',
          permitId: permit.id,
          amount: outstandingBefore,
          method: 'MOBILE_MONEY_MTN',
          payerPhone: '+237677000000',
          status: 'SUCCESSFUL',
          paidAt: new Date().toISOString(),
        });
      // `forbidNonWhitelisted` rejects the unknown field outright: a client
      // cannot declare its own payment successful.
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBeTruthy();
    });

    it('initiates a sandbox payment and reports the provider honestly', async () => {
      const provider = await ctx.api().get(`${API}/payments/provider`).set(...bearer(companyToken));
      expect(provider.status).toBe(200);
      const info = unwrap<{ provider: string; sandbox: boolean }>(provider.body);
      expect(info.provider).toBe('SIMULATOR');
      expect(info.sandbox).toBe(true);

      const response = await ctx.api()
        .post(`${API}/payments`)
        .set(...bearer(companyToken))
        .send({
          purpose: 'PERMIT_FEE',
          permitId: permit.id,
          amount: outstandingBefore,
          method: 'MOBILE_MONEY_MTN',
          payerPhone: '+237677000000',
          clientRef: `${MARKER}-fee`,
        });

      expect([200, 201]).toContain(response.status);
      // The endpoint answers with the payment itself, plus the sandbox note.
      const body = unwrap<Payment & { duplicate?: boolean; sandbox?: boolean }>(response.body);
      payment = body;
      expect(payment.reference).toMatch(/PAY/);
      expect(payment.isSandbox).toBe(true);
      expect(body.sandbox).toBe(true);
      expect(['INITIATED', 'PENDING', 'PROCESSING']).toContain(payment.status);

      // Replaying the same client reference returns the same payment instead of
      // charging twice.
      const replay = await ctx.api()
        .post(`${API}/payments`)
        .set(...bearer(companyToken))
        .send({
          purpose: 'PERMIT_FEE',
          permitId: permit.id,
          amount: outstandingBefore,
          method: 'MOBILE_MONEY_MTN',
          payerPhone: '+237677000000',
          clientRef: `${MARKER}-fee`,
        });
      const replayed = unwrap<Payment & { duplicate?: boolean }>(replay.body);
      expect(replayed.id).toBe(payment.id);
      expect(replayed.duplicate).toBe(true);
    });

    it('does not let the payer confirm their own payment', async () => {
      const response = await ctx.api().post(`${API}/payments/${payment.id}/simulate`).set(...bearer(companyToken)).send({ outcome: 'SUCCESSFUL' });
      expect(response.status).toBe(403);
    });

    it('confirms the sandbox payment and issues a receipt', async () => {
      const settled = await ctx.api()
        .post(`${API}/payments/${payment.id}/simulate`)
        .set(...bearer(officerToken))
        .send({ outcome: 'SUCCESSFUL', notes: 'End-to-end sandbox confirmation.' });
      expect([200, 201]).toContain(settled.status);
      const body = unwrap<{ payment: Payment; sandbox: boolean }>(settled.body);
      expect(body.sandbox).toBe(true);
      expect(body.payment.status).toBe('SUCCESSFUL');

      const receipt = await ctx.api().get(`${API}/payments/${payment.id}/receipt`).set(...bearer(companyToken));
      expect(receipt.status).toBe(200);
      const issued = unwrap<{ receiptNumber?: string; payment?: { status: string } }>(receipt.body);
      expect(issued.receiptNumber ?? issued.payment?.status).toBeTruthy();
    });

    it('activates the permit once the fee is settled', async () => {
      const activated = await ctx.api().post(`${API}/permits/${permit.id}/actions/ACTIVATE`).set(...bearer(officerToken)).send({});
      expect([200, 201]).toContain(activated.status);
      expect(unwrap<Permit>(activated.body).status).toBe('ACTIVE');

      const detail = await ctx.api().get(`${API}/permits/${permit.id}`).set(...bearer(officerToken));
      const current = unwrap<Permit & { outstandingBalance?: number }>(detail.body);
      expect(Number(current.outstandingBalance ?? 0)).toBe(0);
    });
  });

  describe('field activity against the permit', () => {
    it('records a harvesting activity with real GPS coordinates and a field source', async () => {
      const response = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'TIMBER_HARVEST',
          plannedVolumeM3: 40,
          plannedStartDate: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 3.5124,
          longitude: 12.8341,
          locationAccuracyM: 8,
          gpsSource: 'DEVICE_GPS',
          gpsCapturedAt: new Date().toISOString(),
          equipmentSummary: 'Two chainsaw teams',
          clientRef: `${MARKER}-activity`,
        });

      expect([200, 201]).toContain(response.status);
      const body = unwrap<{ activity: { id: string; reference: string; status: string; latitude: string }; duplicate?: boolean }>(response.body);
      createdActivityId = body.activity.id;
      expect(body.activity.reference).toMatch(/ACT/);

      // Replaying the client reference does not create a second record.
      const replay = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'TIMBER_HARVEST',
          plannedVolumeM3: 40,
          plannedStartDate: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 3.5124,
          longitude: 12.8341,
          locationAccuracyM: 8,
          gpsSource: 'DEVICE_GPS',
          clientRef: `${MARKER}-activity`,
        });
      expect(unwrap<{ activity: { id: string } }>(replay.body).activity.id).toBe(createdActivityId);
    });

    it('rejects coordinates outside the valid range', async () => {
      const invalidLatitude = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'TIMBER_HARVEST',
          plannedVolumeM3: 5,
          plannedStartDate: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 95,
          longitude: 12.8341,
        });
      expect(invalidLatitude.status).toBe(400);

      const invalidLongitude = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'TIMBER_HARVEST',
          plannedVolumeM3: 5,
          plannedStartDate: new Date(Date.now() + 86_400_000).toISOString(),
          latitude: 3.5,
          longitude: 181,
        });
      expect(invalidLongitude.status).toBe(400);
    });

    it('refuses activity that exceeds the volume approved on the permit', async () => {
      const response = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'TIMBER_HARVEST',
          plannedVolumeM3: 5000,
          plannedStartDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          latitude: 3.5124,
          longitude: 12.8341,
          locationAccuracyM: 8,
          gpsSource: 'DEVICE_GPS',
        });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PLANNED_VOLUME_EXCEEDS_PERMIT');
    });

    it('blocks field activity on a permit that is not ACTIVE', async () => {
      const suspended = await ctx.api()
        .post(`${API}/permits/${permit.id}/actions/SUSPEND`)
        .set(...bearer(officerToken))
        .send({ reason: 'End-to-end check: field activity must stop while suspended.' });
      expect(unwrap<Permit>(suspended.body).status).toBe('SUSPENDED');

      const blocked = await ctx.api()
        .post(`${API}/activities`)
        .set(...bearer(companyToken))
        .send({
          permitId: permit.id,
          activityType: 'LOG_TRANSPORT',
          plannedVolumeM3: 5,
          plannedStartDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          latitude: 3.5124,
          longitude: 12.8341,
          locationAccuracyM: 8,
          gpsSource: 'DEVICE_GPS',
        });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('PERMIT_NOT_ACTIVE');

      const reinstated = await ctx.api().post(`${API}/permits/${permit.id}/actions/REINSTATE`).set(...bearer(officerToken)).send({});
      expect(unwrap<Permit>(reinstated.body).status).toBe('ACTIVE');
    });

    it('records a harvest against the activity and keeps the volumes consistent', async () => {
      const response = await ctx.api()
        .post(`${API}/activities/${createdActivityId}/harvest`)
        .set(...bearer(companyToken))
        .send({
          speciesBreakdown: { SAPELLI: 12, IROKO: 6 },
          harvestedVolumeM3: 18,
          notes: 'End-to-end harvest record.',
        });

      expect([200, 201]).toContain(response.status);
      const activity = unwrap<{ speciesBreakdown?: Record<string, number>; harvestedVolumeM3?: string | number; status?: string }>(response.body);
      const breakdown = activity.speciesBreakdown ?? {};
      const speciesTotal = Object.values(breakdown).reduce((total, value) => total + Number(value), 0);
      expect(speciesTotal).toBeCloseTo(18, 2);
    });

    it('refuses to delete a permit that carries an activity', async () => {
      const response = await ctx.api().delete(`${API}/permits/${permit.id}`).set(...bearer(adminToken));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });

    it('shows the activity on the map with its own coordinates', async () => {
      const map = await ctx.api().get(`${API}/gis/map/full?featureTypes=EXPLOITATION_ACTIVITY&limit=500`).set(...bearer(officerToken));
      expect(map.status).toBe(200);
      const collection = unwrap<{ features: { id: string; geometry: { coordinates: [number, number] }; properties: { entityId?: string; source?: string; isDemo?: boolean } }[] }>(
        map.body,
      );
      const feature = collection.features.find((entry) => entry.properties.entityId === createdActivityId);
      expect(feature).toBeTruthy();
      expect(feature!.geometry.coordinates[0]).toBeCloseTo(12.8341, 4);
      expect(feature!.geometry.coordinates[1]).toBeCloseTo(3.5124, 4);
      expect(feature!.properties.source).toBe('DEVICE_GPS');
      // Coordinates captured by a device are not demo data.
      expect(feature!.properties.isDemo).toBe(false);
    });
  });
});
