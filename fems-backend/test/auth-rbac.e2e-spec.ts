/**
 * Flow 1 — identity, sessions and role-based access control.
 *
 * These suites drive the real API: a real registration, the real verification
 * code, real JWTs, the real guards. Nothing about the caller's role is taken from
 * the request body — the token decides, and the tests assert that the API refuses
 * what a role may not do.
 */
import { API, DEMO_PASSWORD, bearer, createFlowContext, unwrap, type FlowContext } from './setup/app';

describe('Flows — registration, sessions and RBAC (e2e)', () => {
  let ctx: FlowContext;
  const createdEmails: string[] = [];
  // Demo ids are UUIDs, so the suites resolve the records they act on through
  // the API instead of hard-coding a literal that a reseed would invalidate.
  let seededPermitId = '';
  let seededAlertId = '';

  beforeAll(async () => {
    ctx = await createFlowContext();
  });

  afterAll(async () => {
    if (createdEmails.length) {
      // Test accounts are removed so repeated runs stay clean; the flows
      // themselves never delete anything they did not create.
      const users = await ctx.prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await ctx.prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await ctx.prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
      await ctx.prisma.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
      await ctx.prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
      await ctx.prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await ctx.close();
  });

  it('registers an account, verifies the address and signs in', async () => {
    const email = `e2e.register.${Date.now()}@e2e.fems.test`;
    createdEmails.push(email);

    const registered = await ctx.api().post(`${API}/auth/register`).send({
      email,
      password: 'E2e-Register#2026',
      firstName: 'E2e',
      lastName: 'Registrar',
    });
    expect(registered.status).toBe(201);
    const registration = unwrap<{ user: { id: string; status: string }; verification: { developmentCode?: string; emailDelivery: string } }>(
      registered.body,
    );
    expect(registration.user.status).toBe('PENDING_VERIFICATION');
    // Mail is not configured in this environment, so the API returns the code and
    // says why instead of pretending an email was delivered.
    expect(registration.verification.emailDelivery).toBe('NOT_CONFIGURED');
    expect(registration.verification.developmentCode).toBeTruthy();

    const verified = await ctx.api().post(`${API}/auth/email-verification/verify`).send({ token: registration.verification.developmentCode });
    expect([200, 201]).toContain(verified.status);
    const session = unwrap<{ user: { status: string }; tokens: { accessToken: string } }>(verified.body);
    expect(session.user.status).toBe('ACTIVE');
    expect(session.tokens.accessToken).toBeTruthy();

    const me = await ctx.api().get(`${API}/auth/me`).set(...bearer(session.tokens.accessToken));
    expect(me.status).toBe(200);
    expect(unwrap<{ email: string }>(me.body).email).toBe(email);
  });

  it('refuses a second account on the same address', async () => {
    const email = `e2e.duplicate.${Date.now()}@e2e.fems.test`;
    createdEmails.push(email);
    const payload = { email, password: 'E2e-Duplicate#2026', firstName: 'E2e', lastName: 'Duplicate' };
    await ctx.api().post(`${API}/auth/register`).send(payload);
    const again = await ctx.api().post(`${API}/auth/register`).send(payload);
    expect([400, 409]).toContain(again.status);
    expect(again.body.success).toBe(false);
  });

  it('completes the forgot-password → reset → login cycle', async () => {
    const email = `e2e.reset.${Date.now()}@e2e.fems.test`;
    createdEmails.push(email);
    await ctx.api().post(`${API}/auth/register`).send({ email, password: 'E2e-Reset#2026', firstName: 'E2e', lastName: 'Reset' });

    const forgot = await ctx.api().post(`${API}/auth/password/forgot`).send({ email });
    expect([200, 201]).toContain(forgot.status);
    const issued = unwrap<{ developmentCode?: string }>(forgot.body);
    expect(issued.developmentCode).toBeTruthy();

    const reset = await ctx.api().post(`${API}/auth/password/reset`).send({ token: issued.developmentCode, newPassword: 'E2e-Reset#2027' });
    expect([200, 201]).toContain(reset.status);

    const login = await ctx.api().post(`${API}/auth/login`).send({ email, password: 'E2e-Reset#2027' });
    expect([200, 201]).toContain(login.status);
    expect(unwrap<{ tokens: { accessToken: string } }>(login.body).tokens.accessToken).toBeTruthy();

    // The old password no longer works.
    const stale = await ctx.api().post(`${API}/auth/login`).send({ email, password: 'E2e-Reset#2026' });
    expect(stale.status).toBe(401);
  });

  it('rotates the refresh token and signs the session out', async () => {
    const session = await ctx.session('demo.officer@fems.cm', DEMO_PASSWORD);

    const refreshed = await ctx.api().post(`${API}/auth/refresh`).send({ refreshToken: session.refreshToken });
    expect([200, 201]).toContain(refreshed.status);
    const rotated = unwrap<{ tokens: { accessToken: string; refreshToken: string } }>(refreshed.body);
    expect(rotated.tokens.refreshToken).not.toBe(session.refreshToken);

    // Signing out is an authenticated call: the access token proves who is
    // ending the session, the refresh token says which one.
    const loggedOut = await ctx.api()
      .post(`${API}/auth/logout`)
      .set(...bearer(rotated.tokens.accessToken))
      .send({ refreshToken: rotated.tokens.refreshToken });
    expect([200, 201, 204]).toContain(loggedOut.status);

    // A signed-out refresh token cannot be replayed.
    const replayed = await ctx.api().post(`${API}/auth/refresh`).send({ refreshToken: rotated.tokens.refreshToken });
    expect(replayed.status).toBe(401);
    expect(replayed.body.success).toBe(false);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await ctx.api().post(`${API}/auth/login`).send({ email: 'demo.officer@fems.cm', password: 'not-the-password' });
    expect(wrongPassword.status).toBe(401);

    const unknownAccount = await ctx.api().post(`${API}/auth/login`).send({ email: `nobody.${Date.now()}@e2e.fems.test`, password: 'not-the-password' });
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('validates the registration payload', async () => {
    const invalid = await ctx.api().post(`${API}/auth/register`).send({ email: 'not-an-email', password: 'short', firstName: 'A', lastName: 'B' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.error.code).toBeTruthy();
  });

  describe('role-based access control', () => {
    const tokens: Record<string, string> = {};

    beforeAll(async () => {
      for (const [role, email] of Object.entries({
        admin: 'demo.admin@fems.cm',
        officer: 'demo.officer@fems.cm',
        environment: 'demo.environment@fems.cm',
        inspector: 'demo.inspector@fems.cm',
        operator: 'demo.operator@fems.cm',
        company: 'demo.company@fems.cm',
        explorer: 'demo.explorer@fems.cm',
        visitor: 'demo.visitor@fems.cm',
      })) {
        tokens[role] = await ctx.login(email, DEMO_PASSWORD);
      }

      const permits = await ctx.api().get(`${API}/permits?limit=5`).set(...bearer(tokens.officer));
      seededPermitId = unwrap<{ id: string }[]>(permits.body)[0].id;

      const alerts = await ctx.api().get(`${API}/ai/alerts?limit=5`).set(...bearer(tokens.officer));
      seededAlertId = unwrap<{ id: string }[]>(alerts.body)[0].id;
    });

    it('lets anonymous callers read the public forest catalogue and nothing else', async () => {
      const forests = await ctx.api().get(`${API}/forests`);
      expect(forests.status).toBe(200);
      expect(Array.isArray(unwrap<unknown[]>(forests.body))).toBe(true);

      // Everything else — including the map layers, which describe the whole
      // national register — needs a session.
      for (const path of ['/gis/layers', '/gis/map/full', '/permits', '/users', '/audit', '/payments', '/ai/alerts', '/inspections']) {
        const response = await ctx.api().get(`${API}${path}`);
        expect(response.status).toBe(401);
      }
    });

    it('keeps the visitor role read-only', async () => {
      const permits = await ctx.api().get(`${API}/permits`).set(...bearer(tokens.visitor));
      expect(permits.status).toBe(403);

      const users = await ctx.api().get(`${API}/users`).set(...bearer(tokens.visitor));
      expect(users.status).toBe(403);

      const alertReview = await ctx.api()
        .post(`${API}/ai/alerts/${seededAlertId}/review`)
        .set(...bearer(tokens.visitor))
        .send({ action: 'START_REVIEW' });
      expect(alertReview.status).toBe(403);
    });

    it('scopes a company account to its own file and its own data', async () => {
      const mine = await ctx.api().get(`${API}/companies/me`).set(...bearer(tokens.company));
      expect(mine.status).toBe(200);
      const myCompany = unwrap<{ id: string; name: string }>(mine.body);

      const register = await ctx.api().get(`${API}/companies`).set(...bearer(tokens.company));
      expect(register.status).toBe(200);
      const visible = unwrap<{ id: string }[]>(register.body);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(myCompany.id);

      const others = await ctx.api().get(`${API}/companies?limit=100`).set(...bearer(tokens.officer));
      const otherCompany = unwrap<{ id: string }[]>(others.body).find((company) => company.id !== myCompany.id);
      expect(otherCompany).toBeTruthy();

      const forbidden = await ctx.api().get(`${API}/companies/${otherCompany!.id}`).set(...bearer(tokens.company));
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('COMPANY_SCOPE_FORBIDDEN');
    });

    it('scopes a company account to its own case files', async () => {
      const mine = await ctx.api().get(`${API}/companies/me`).set(...bearer(tokens.company));
      const companyId = unwrap<{ id: string }>(mine.body).id;

      const cases = await ctx.api().get(`${API}/violations?limit=50`).set(...bearer(tokens.company));
      expect(cases.status).toBe(200);
      const rows = unwrap<{ companyId: string }[]>(cases.body);
      expect(rows.every((row) => row.companyId === companyId)).toBe(true);

      // The public-facing roles cannot see case files at all.
      for (const role of ['explorer', 'visitor']) {
        const denied = await ctx.api().get(`${API}/violations`).set(...bearer(tokens[role]));
        expect(denied.status).toBe(403);
      }
    });

    it('keeps the user directory and the audit trail for the administration and the forest service', async () => {
      for (const role of ['admin', 'officer']) {
        const users = await ctx.api().get(`${API}/users`).set(...bearer(tokens[role]));
        expect(users.status).toBe(200);
        const audit = await ctx.api().get(`${API}/audit?limit=5`).set(...bearer(tokens[role]));
        expect(audit.status).toBe(200);
      }

      for (const role of ['environment', 'inspector', 'operator', 'company', 'explorer', 'visitor']) {
        const users = await ctx.api().get(`${API}/users`).set(...bearer(tokens[role]));
        expect(users.status).toBe(403);
        const audit = await ctx.api().get(`${API}/audit`).set(...bearer(tokens[role]));
        expect(audit.status).toBe(403);
      }

      // Only an administrator may create an account.
      for (const role of ['officer', 'inspector', 'environment', 'company']) {
        const created = await ctx.api()
          .post(`${API}/users`)
          .set(...bearer(tokens[role]))
          .send({ email: `e2e.forbidden.${role}@e2e.fems.test`, firstName: 'E2e', lastName: 'Forbidden', role: 'VISITOR' });
        expect(created.status).toBe(403);
      }
    });

    it('lets an inspector run inspections but not read the payment register', async () => {
      const inspections = await ctx.api().get(`${API}/inspections`).set(...bearer(tokens.inspector));
      expect(inspections.status).toBe(200);

      const payments = await ctx.api().get(`${API}/payments`).set(...bearer(tokens.inspector));
      expect(payments.status).toBe(403);

      // The action catalogue is the server's own answer to "what may this caller
      // do here?" — it must not offer approve/reject to an inspector.
      const actions = await ctx.api().get(`${API}/permits/${seededPermitId}/actions`).set(...bearer(tokens.inspector));
      expect(actions.status).toBe(200);
      const catalogue = unwrap<{ actions: { action: string }[] }>(actions.body);
      expect(catalogue.actions.map((entry) => entry.action)).not.toContain('APPROVE');
      expect(catalogue.actions.map((entry) => entry.action)).not.toContain('REVOKE');
    });

    it('refuses a forged role in the request body', async () => {
      // The role is read from the token, never from the payload: sending a role
      // with a review action must not widen what the caller may do.
      const forged = await ctx.api()
        .post(`${API}/ai/alerts/${seededAlertId}/review`)
        .set(...bearer(tokens.visitor))
        .send({ action: 'START_REVIEW', role: 'ADMINISTRATOR', permissions: ['*'] });
      expect([400, 403]).toContain(forged.status);
    });

    it('refuses to let an administrator suspend their own account', async () => {
      const me = await ctx.api().get(`${API}/auth/me`).set(...bearer(tokens.admin));
      const adminId = unwrap<{ id: string }>(me.body).id;

      const response = await ctx.api()
        .patch(`${API}/users/${adminId}/status`)
        .set(...bearer(tokens.admin))
        .send({ status: 'SUSPENDED', reason: 'End-to-end attempt to suspend myself.' });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SELF_STATUS_CHANGE_FORBIDDEN');
    });

    it('requires the current password to change a password', async () => {
      const wrong = await ctx.api()
        .post(`${API}/auth/password/change`)
        .set(...bearer(tokens.visitor))
        .send({ currentPassword: 'definitely-not-it', newPassword: 'E2e-Change#2026' });
      expect([400, 401]).toContain(wrong.status);

      // Changing it back and forth would disturb the seed, so the test stops at
      // the refusal: the happy path is covered by the reset flow above.
    });
  });
});
