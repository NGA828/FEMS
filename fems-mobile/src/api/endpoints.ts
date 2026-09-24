/**
 * Typed wrappers around every FEMS endpoint the mobile app uses.
 *
 * Screens never call `fetch` directly: they call one of these functions through a
 * React Query hook, so paths, parameters and payload shapes live in exactly one
 * place and stay in sync with the NestJS controllers.
 */
import { api } from './client-instance';
import type { Paginated } from './client';
import type {
  AiAlert,
  AiAnalysis,
  AiCatalogue,
  AiConversation,
  AiStatus,
  AlertStatistics,
  AssistantAnswer,
  AuditEntry,
  Company,
  DirectoryUser,
  Equipment,
  Evidence,
  ExploitationActivity,
  FieldObservation,
  Forest,
  ForestZone,
  GisFeature,
  GisLayerInfo,
  GisMapPayload,
  GisPosition,
  GisStatistics,
  HealthStatus,
  Inspection,
  InspectionStatistics,
  NearbyResult,
  AppNotification,
  Payment,
  PaymentProviderInfo,
  PaymentStatistics,
  Permit,
  PermitActionsPayload,
  PermitDocument,
  PermitStatistics,
  PermitTimelineEntry,
  ProtectedArea,
  Report,
  ReportCatalogue,
  ReportStatistics,
  RoleSummary,
  Violation,
  ViolationStatistics,
} from './types';

// --------------------------------------------------------------------- helpers

export interface PageQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CatalogueEntry {
  name: string;
  label: string;
  description?: string;
  level?: number;
  permissions?: string[];
}

// ------------------------------------------------------------------------ auth

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  requestedRole?: 'FOREST_EXPLORER' | 'COMPANY_REPRESENTATIVE';
  companyName?: string;
  companyRegistrationNumber?: string;
  companyType?: string;
  companyCity?: string;
  companyRegion?: string;
  companyAddress?: string;
  companyPhone?: string;
}

export interface RegisterResult {
  user: DirectoryUser;
  verification: {
    expiresAt: string;
    /** How the backend actually delivered the code — never assumed. */
    emailDelivery: 'SENT' | 'NOT_CONFIGURED' | 'FAILED';
    emailDeliveryMessage: string;
    /** Present outside production when SMTP is unavailable, so the flow stays testable. */
    developmentCode?: string;
  };
}

export interface DeliveryMessage {
  message: string;
  emailDelivery: 'SENT' | 'NOT_SENT' | 'NOT_CONFIGURED' | 'FAILED' | string;
  developmentCode?: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{ user: DirectoryUser & { permissions: string[] }; tokens: { accessToken: string; refreshToken: string; expiresIn?: number } }>(
        '/auth/login',
        { email, password },
        { auth: false, retries: 0 },
      )
      .then((r) => r.data),

  register: (payload: RegisterPayload) => api.post<RegisterResult>('/auth/register', payload, { auth: false }).then((r) => r.data),

  verifyEmail: (token: string) =>
    api
      .post<{ user: DirectoryUser; tokens: { accessToken: string; refreshToken: string; expiresIn?: number } }>(
        '/auth/email-verification/verify',
        { token },
        { auth: false, retries: 0 },
      )
      .then((r) => r.data),

  resendVerification: (email: string) =>
    api.post<DeliveryMessage>('/auth/email-verification/resend', { email }, { auth: false, retries: 0 }).then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post<DeliveryMessage>('/auth/password/forgot', { email }, { auth: false, retries: 0 }).then((r) => r.data),

  resetPassword: (token: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/password/reset', { token, newPassword }, { auth: false, retries: 0 }).then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/password/change', { currentPassword, newPassword }).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post<{ tokens: { accessToken: string; refreshToken: string; expiresIn?: number } }>('/auth/refresh', { refreshToken }, { auth: false, retries: 0 }).then((r) => r.data.tokens),

  logout: (refreshToken?: string) => api.post<{ message: string }>('/auth/logout', refreshToken ? { refreshToken } : {}).then((r) => r.data),

  me: () => api.get<DirectoryUser & { permissions: string[] }>('/auth/me').then((r) => r.data),

  updateProfile: (payload: { firstName?: string; lastName?: string; phone?: string; jobTitle?: string; preferredLanguage?: string }) =>
    api.patch<DirectoryUser>('/auth/me', payload).then((r) => r.data),

  sessions: () => api.get<{ id: string; device?: string; ipAddress?: string; createdAt: string; lastUsedAt?: string; current?: boolean }[]>('/auth/sessions').then((r) => r.data),

  revokeSession: (sessionId: string) => api.delete<{ message: string }>(`/auth/sessions/${sessionId}`).then((r) => r.data),

  notificationPreferences: () =>
    api.get<{ channel: string; enabled: boolean }[]>('/auth/notification-preferences').then((r) => r.data),

  updateNotificationPreferences: (preferences: { channel: string; enabled: boolean }[]) =>
    api.put<{ channel: string; enabled: boolean }[]>('/auth/notification-preferences', { preferences }).then((r) => r.data),
};

// ---------------------------------------------------------------- users & roles

export const usersApi = {
  list: (query: PageQuery & { role?: string; status?: string; companyId?: string } = {}) => api.list<DirectoryUser>('/users', { params: query as never }),
  get: (id: string) => api.get<DirectoryUser>(`/users/${id}`).then((r) => r.data),
  create: (payload: Record<string, unknown>) => api.post<{ user: DirectoryUser }>('/users', payload).then((r) => r.data.user),
  update: (id: string, payload: Record<string, unknown>) => api.patch<DirectoryUser>(`/users/${id}`, payload).then((r) => r.data),
  setStatus: (id: string, status: string, reason?: string) =>
    api.post<DirectoryUser>(`/users/${id}/status`, { status, reason }).then((r) => r.data),
  resetPassword: (id: string, newPassword?: string) =>
    api.post<{ temporaryPassword?: string; message: string }>(`/users/${id}/reset-password`, newPassword ? { newPassword } : {}).then((r) => r.data),
  roles: () => api.get<CatalogueEntry[]>('/roles/catalogue').then((r) => r.data),
  roleList: () => api.get<RoleSummary[]>('/roles').then((r) => r.data),
};

// ------------------------------------------------------------------- companies

export const companiesApi = {
  list: (query: PageQuery & { status?: string; type?: string; region?: string } = {}) =>
    api.list<Company>('/companies', { params: query as never }),
  get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
  mine: () => api.get<Company>('/companies/me').then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Company>(`/companies/${id}`, payload).then((r) => r.data),
  verify: (id: string, payload: { approved: boolean; reason?: string }) => api.post<Company>(`/companies/${id}/verify`, payload).then((r) => r.data),
  statistics: () => api.get<{ total: number; byStatus: { status: string; count: number }[]; byType: { type: string; count: number }[]; verified: number; pending: number }>('/companies/statistics').then((r) => r.data),
  documents: (id: string) => api.get<{ id: string; type: string; title: string; fileKey: string; mimeType: string; sizeBytes: number; isVerified: boolean; createdAt: string }[]>(`/companies/${id}/documents`).then((r) => r.data),
  addDocument: (id: string, payload: { type: string; title: string; fileKey: string; mimeType: string; sizeBytes: number; notes?: string }) =>
    api.post(`/companies/${id}/documents`, payload).then((r) => r.data),
};

// --------------------------------------------------------------------- forests

export interface ForestQuery extends PageQuery {
  region?: string;
  status?: string;
  type?: string;
  myCompany?: boolean;
}

export const forestsApi = {
  list: (query: ForestQuery = {}) => api.list<Forest>('/forests', { params: query as never }),
  get: (id: string) => api.get<Forest>(`/forests/${id}`).then((r) => r.data),
  zones: (forestId: string) => api.get<ForestZone[]>(`/forests/${forestId}/zones`).then((r) => r.data),
  statistics: () =>
    api
      .get<{
        total: number;
        totalAreaHa: number;
        byStatus: { status: string; count: number }[];
        byRegion: { region: string; count: number; areaHa: number }[];
        byType: { type: string; count: number }[];
        totalAnnualAllowableCutM3: number;
      }>('/forests/statistics')
      .then((r) => r.data),
  inventoryStatistics: () => api.get<Record<string, unknown>>('/forests/inventory/statistics').then((r) => r.data),
  protectedAreas: (query: PageQuery & { region?: string; type?: string } = {}) =>
    api.list<ProtectedArea>('/protected-areas', { params: query as never }),
  protectedArea: (id: string) => api.get<ProtectedArea>(`/protected-areas/${id}`).then((r) => r.data),
  species: (query: PageQuery & { protectedStatus?: string } = {}) => api.list<Record<string, unknown>>('/tree-species', { params: query as never }),
  inventory: (query: PageQuery & { forestId?: string; zoneId?: string; speciesId?: string } = {}) =>
    api.list<Record<string, unknown>>('/inventory', { params: query as never }),
};

// --------------------------------------------------------------------- permits

export interface PermitQuery extends PageQuery {
  status?: string;
  type?: string;
  priority?: string;
  forestId?: string;
  companyId?: string;
  awaitingMyAction?: boolean;
  expiringWithinDays?: number;
}

export const permitsApi = {
  list: (query: PermitQuery = {}) => api.list<Permit>('/permits', { params: query as never }),
  get: (id: string) => api.get<Permit>(`/permits/${id}`).then((r) => r.data),
  statistics: () => api.get<PermitStatistics>('/permits/statistics').then((r) => r.data),
  expiring: (days = 60) => api.get<Permit[]>('/permits/expiring', { params: { days } }).then((r) => r.data),
  lifecycle: () => api.get<Record<string, unknown>>('/permits/lifecycle').then((r) => r.data),
  create: (payload: Record<string, unknown>) => api.post<Permit>('/permits', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Permit>(`/permits/${id}`, payload).then((r) => r.data),
  actions: (id: string) => api.get<PermitActionsPayload>(`/permits/${id}/actions`).then((r) => r.data),
  timeline: (id: string) => api.get<PermitTimelineEntry[]>(`/permits/${id}/timeline`).then((r) => r.data),
  act: (id: string, action: string, payload: { reason?: string; volumeApprovedM3?: number; endDate?: string; conditions?: string } = {}) =>
    api.post<Permit>(`/permits/${id}/actions/${action}`, payload).then((r) => r.data),
  renew: (id: string, payload: { startDate?: string; endDate?: string; volumeRequestedM3?: number; notes?: string } = {}) =>
    api.post<Permit>(`/permits/${id}/renew`, payload).then((r) => r.data),
  documents: (id: string) => api.get<PermitDocument[]>(`/permits/${id}/documents`).then((r) => r.data),
  addDocument: (id: string, payload: { type: string; title: string; fileKey: string; mimeType: string; sizeBytes: number; checksum?: string; notes?: string }) =>
    api.post<PermitDocument>(`/permits/${id}/documents`, payload).then((r) => r.data),
  verifyDocument: (id: string, documentId: string, payload: { isVerified: boolean; notes?: string }) =>
    api.patch<PermitDocument>(`/permits/${id}/documents/${documentId}/verify`, payload).then((r) => r.data),
};

// ---------------------------------------------------------------- exploitation

export interface ActivityQuery extends PageQuery {
  permitId?: string;
  companyId?: string;
  forestId?: string;
  zoneId?: string;
  status?: string;
  activityType?: string;
  from?: string;
  to?: string;
  mine?: boolean;
}

export interface CreateActivityPayload {
  permitId: string;
  activityType: string;
  zoneId?: string;
  plannedVolumeM3: number;
  plannedStartDate: string;
  plannedEndDate?: string;
  latitude: number;
  longitude: number;
  locationAccuracyM?: number;
  gpsSource?: string;
  gpsCapturedAt?: string;
  equipmentSummary?: string;
  observations?: string;
  speciesBreakdown?: Record<string, number>;
  assignedToId?: string;
  clientRef?: string;
}

export interface OfflineSyncResult {
  created: number;
  duplicates: number;
  rejected: number;
  errors?: { clientRef: string; code: string; message: string }[];
}

export const activitiesApi = {
  list: (query: ActivityQuery = {}) => api.list<ExploitationActivity>('/activities', { params: query as never }),
  get: (id: string) => api.get<ExploitationActivity>(`/activities/${id}`).then((r) => r.data),
  statistics: (params: { forestId?: string; months?: number; topCompanies?: number } = {}) =>
    api.get<Record<string, unknown>>('/activities/statistics', { params }).then((r) => r.data),
  create: (payload: CreateActivityPayload) => api.post<ExploitationActivity>('/activities', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<ExploitationActivity>(`/activities/${id}`, payload).then((r) => r.data),
  act: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    api.post<ExploitationActivity>(`/activities/${id}/actions/${action}`, payload).then((r) => r.data),
  recordHarvest: (id: string, payload: { harvestedVolumeM3: number; harvestedTreeCount: number; speciesBreakdown?: Record<string, number>; observations?: string; clientRef?: string }) =>
    api.post<ExploitationActivity>(`/activities/${id}/harvest`, payload).then((r) => r.data),
  attachEquipment: (id: string, payload: { equipmentId: string; hoursUsed?: number; volumeM3?: number; notes?: string }) =>
    api.post<ExploitationActivity>(`/activities/${id}/equipment`, payload).then((r) => r.data),
  syncOffline: (records: OfflineActivityRecord[]) => api.post<OfflineSyncResult>('/activities/offline-sync', { records }).then((r) => r.data),
  equipment: (query: PageQuery & { status?: string; category?: string; companyId?: string } = {}) =>
    api.list<Equipment>('/equipment', { params: query as never }),
  createEquipment: (payload: Record<string, unknown>) => api.post<Equipment>('/equipment', payload).then((r) => r.data),
  updateEquipment: (id: string, payload: Record<string, unknown>) => api.patch<Equipment>(`/equipment/${id}`, payload).then((r) => r.data),
};

export interface OfflineActivityRecord {
  clientRef: string;
  activityType: string;
  permitId: string;
  zoneId?: string;
  plannedVolumeM3: number;
  plannedStartDate: string;
  latitude: number;
  longitude: number;
  locationAccuracyM?: number;
  gpsSource?: string;
  gpsCapturedAt?: string;
  equipmentSummary?: string;
  observations?: string;
}

// -------------------------------------------------------------------- payments

export interface PaymentQuery extends PageQuery {
  status?: string;
  purpose?: string;
  permitId?: string;
  companyId?: string;
  from?: string;
  to?: string;
}

export const paymentsApi = {
  list: (query: PaymentQuery = {}) => api.list<Payment>('/payments', { params: query as never }),
  get: (id: string) => api.get<Payment>(`/payments/${id}`).then((r) => r.data),
  statistics: () => api.get<PaymentStatistics>('/payments/statistics').then((r) => r.data),
  provider: () => api.get<PaymentProviderInfo>('/payments/provider').then((r) => r.data),
  initiate: (payload: {
    purpose: string;
    amount: number;
    method: string;
    permitId?: string;
    violationId?: string;
    payerPhone?: string;
    notes?: string;
    clientRef?: string;
  }) => api.post<Payment>('/payments', payload, { retries: 0 }).then((r) => r.data),
  receipt: (id: string) => api.get<{ reference: string; receiptNumber?: string; amount: number; currency: string; paidAt?: string; purpose: string; company?: string; permitNumber?: string; verificationCode?: string }>(`/payments/${id}/receipt`).then((r) => r.data),
  verify: (id: string, notes?: string) => api.post<Payment>(`/payments/${id}/verify`, { notes }).then((r) => r.data),
  simulate: (id: string, outcome: 'SUCCESSFUL' | 'FAILED' | 'CANCELLED', notes?: string) =>
    api.post<Payment>(`/payments/${id}/simulate`, { outcome, notes }).then((r) => r.data),
  refund: (id: string, reason: string) => api.post<Payment>(`/payments/${id}/refund`, { reason }).then((r) => r.data),
};

// ----------------------------------------------------------------- inspections

export interface InspectionQuery extends PageQuery {
  status?: string;
  type?: string;
  outcome?: string;
  forestId?: string;
  companyId?: string;
  permitId?: string;
  inspectorId?: string;
  mine?: 'true' | 'false';
  from?: string;
  to?: string;
}

export interface CreateInspectionPayload {
  type: string;
  title: string;
  forestId: string;
  zoneId?: string;
  protectedAreaId?: string;
  companyId?: string;
  permitId?: string;
  activityId?: string;
  inspectorId?: string;
  scheduledFor?: string;
  checklist?: { code: string; label: string; result?: string; notes?: string; sortOrder?: number }[];
}

export const inspectionsApi = {
  list: (query: InspectionQuery = {}) => api.list<Inspection>('/inspections', { params: query as never }),
  get: (id: string) => api.get<Inspection>(`/inspections/${id}`).then((r) => r.data),
  statistics: () => api.get<InspectionStatistics>('/inspections/statistics').then((r) => r.data),
  create: (payload: CreateInspectionPayload) => api.post<Inspection>('/inspections', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Inspection>(`/inspections/${id}`, payload).then((r) => r.data),
  start: (id: string, payload: { latitude: number; longitude: number; locationAccuracyM?: number; gpsSource?: string; gpsCapturedAt?: string }) =>
    api.post<Inspection>(`/inspections/${id}/start`, payload).then((r) => r.data),
  submit: (
    id: string,
    payload: {
      outcome: string;
      summary?: string;
      recommendations?: string;
      checklist?: { code: string; label: string; result: string; notes?: string; sortOrder?: number }[];
      verifiedHarvestedVolumeM3?: number;
      verifiedTreeCount?: number;
      discrepancies?: string;
      clientRef?: string;
    },
  ) => api.post<Inspection>(`/inspections/${id}/submit`, payload).then((r) => r.data),
  review: (id: string, payload: { outcome?: string; notes?: string; recommendations?: string }) =>
    api.post<Inspection>(`/inspections/${id}/review`, payload).then((r) => r.data),
  close: (id: string, payload: { summary?: string } = {}) => api.post<Inspection>(`/inspections/${id}/close`, payload).then((r) => r.data),
  cancel: (id: string, reason: string) => api.post<Inspection>(`/inspections/${id}/cancel`, { reason }).then((r) => r.data),
  evidence: (query: PageQuery & { inspectionId?: string; observationId?: string; activityId?: string; violationId?: string } = {}) =>
    api.list<Evidence>('/inspections/evidence', { params: query as never }),
  attachEvidence: (payload: Record<string, unknown>) => api.post<Evidence>('/inspections/evidence', payload).then((r) => r.data),
};

// ---------------------------------------------------------------- observations

export interface ObservationQuery extends PageQuery {
  category?: string;
  severity?: string;
  forestId?: string;
  inspectionId?: string;
  activityId?: string;
  observedById?: string;
  mine?: boolean;
  from?: string;
  to?: string;
}

export interface CreateObservationPayload {
  category: string;
  title: string;
  description: string;
  forestId: string;
  zoneId?: string;
  protectedAreaId?: string;
  activityId?: string;
  inspectionId?: string;
  severity?: string;
  latitude: number;
  longitude: number;
  locationAccuracyM?: number;
  gpsSource?: string;
  capturedAt?: string;
  clientRef?: string;
}

export const observationsApi = {
  list: (query: ObservationQuery = {}) => api.list<FieldObservation>('/observations', { params: query as never }),
  get: (id: string) => api.get<FieldObservation>(`/observations/${id}`).then((r) => r.data),
  statistics: () => api.get<Record<string, unknown>>('/observations/statistics').then((r) => r.data),
  create: (payload: CreateObservationPayload) => api.post<FieldObservation>('/observations', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<FieldObservation>(`/observations/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete<{ message: string }>(`/observations/${id}`).then((r) => r.data),
  syncOffline: (records: (CreateObservationPayload & { clientRef: string })[]) =>
    api.post<OfflineSyncResult>('/observations/offline-sync', { records }).then((r) => r.data),
};

// ------------------------------------------------------------------ violations

export interface ViolationQuery extends PageQuery {
  status?: string;
  severity?: string;
  forestId?: string;
  companyId?: string;
  permitId?: string;
  inspectionId?: string;
  overdueRemediation?: 'true' | 'false';
  from?: string;
  to?: string;
}

export const violationsApi = {
  list: (query: ViolationQuery = {}) => api.list<Violation>('/violations', { params: query as never }),
  get: (id: string) => api.get<Violation>(`/violations/${id}`).then((r) => r.data),
  statistics: () => api.get<ViolationStatistics>('/violations/statistics').then((r) => r.data),
  penalty: (id: string) => api.get<Violation['penalty']>(`/violations/${id}/penalty`).then((r) => r.data),
  create: (payload: Record<string, unknown>) => api.post<Violation>('/violations', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Violation>(`/violations/${id}`, payload).then((r) => r.data),
  act: (id: string, action: string, payload: Record<string, unknown> = {}) =>
    api.post<Violation>(`/violations/${id}/actions/${action}`, payload).then((r) => r.data),
};

// -------------------------------------------------------------------------- AI

export interface AlertQuery extends PageQuery {
  status?: string;
  type?: string;
  riskLevel?: string;
  detector?: string;
  forestId?: string;
  companyId?: string;
  permitId?: string;
  awaitingReview?: 'true' | 'false';
  from?: string;
  to?: string;
}

export const aiApi = {
  status: () => api.get<AiStatus>('/ai/status').then((r) => r.data),
  catalogue: () => api.get<AiCatalogue>('/ai/catalogue').then((r) => r.data),
  runAnalysis: (payload: { type: string; forestId?: string; zoneId?: string; companyId?: string; permitId?: string; periodDays?: number; useProvider?: boolean }) =>
    api.post<AiAnalysis>('/ai/analyses', payload, { timeoutMs: 60_000, retries: 0 }).then((r) => r.data),
  analyses: (query: PageQuery & { type?: string; status?: string; forestId?: string } = {}) =>
    api.list<AiAnalysis>('/ai/analyses', { params: query as never }),
  analysis: (id: string) => api.get<AiAnalysis>(`/ai/analyses/${id}`).then((r) => r.data),
  alerts: (query: AlertQuery = {}) => api.list<AiAlert>('/ai/alerts', { params: query as never }),
  alert: (id: string) => api.get<AiAlert>(`/ai/alerts/${id}`).then((r) => r.data),
  alertStatistics: () => api.get<AlertStatistics>('/ai/alerts/statistics').then((r) => r.data),
  reviewAlert: (id: string, payload: { action: string; reason?: string; evidenceNote?: string; resolutionAction?: string; violationId?: string; requestInspection?: boolean }) =>
    api.post<AiAlert>(`/ai/alerts/${id}/review`, payload, { retries: 0 }).then((r) => r.data),
  ask: (payload: { question: string; conversationId?: string; forestId?: string; companyId?: string; permitId?: string; fallbackToRules?: boolean }) =>
    api.post<AssistantAnswer>('/ai/assistant/ask', payload, { timeoutMs: 60_000, retries: 0 }).then((r) => r.data),
  conversations: (query: PageQuery & { includeArchived?: 'true' | 'false' } = {}) => api.list<AiConversation>('/ai/assistant/conversations', { params: query as never }),
  conversation: (id: string) => api.get<AiConversation>(`/ai/assistant/conversations/${id}`).then((r) => r.data),
  archiveConversation: (id: string) => api.patch<AiConversation>(`/ai/assistant/conversations/${id}/archive`).then((r) => r.data),
  deleteConversation: (id: string) => api.delete<{ message: string }>(`/ai/assistant/conversations/${id}`).then((r) => r.data),
};

// --------------------------------------------------------------------- reports

export interface ReportQuery extends PageQuery {
  type?: string;
  format?: string;
  status?: string;
  companyId?: string;
  forestId?: string;
  from?: string;
  to?: string;
}

export const reportsApi = {
  list: (query: ReportQuery = {}) => api.list<Report>('/reports', { params: query as never }),
  get: (id: string) => api.get<Report>(`/reports/${id}`).then((r) => r.data),
  catalogue: () => api.get<ReportCatalogue>('/reports/catalogue').then((r) => r.data),
  statistics: () => api.get<ReportStatistics>('/reports/statistics').then((r) => r.data),
  preview: (payload: { type: string; from?: string; to?: string; forestId?: string; companyId?: string; permitId?: string; maxRows?: number }) =>
    api.post<{ columns: { key: string; label: string }[]; rows: (string | number | null)[][]; summary: { label: string; value: string }[]; rowCount: number; truncated: boolean }>(
      '/reports/preview',
      payload,
      { timeoutMs: 45_000 },
    ).then((r) => r.data),
  create: (payload: { type: string; format?: string; title?: string; from?: string; to?: string; forestId?: string; companyId?: string; permitId?: string; maxRows?: number }) =>
    api.post<Report>('/reports', payload, { timeoutMs: 60_000, retries: 0 }).then((r) => r.data),
  send: (id: string, payload: { audience?: 'OFFICERS' | 'COMPANIES'; message?: string }) =>
    api.post<{ recipients: number; message: string }>(`/reports/${id}/send`, payload).then((r) => r.data),
  remove: (id: string) => api.delete<{ message: string }>(`/reports/${id}`).then((r) => r.data),
  downloadUrl: (id: string) => api.buildUrl(`/reports/${id}/download`),
};

// --------------------------------------------------------------- notifications

export const notificationsApi = {
  list: (query: PageQuery & { unreadOnly?: boolean; type?: string } = {}) => api.list<AppNotification>('/notifications', { params: query as never }),
  unreadCount: () => api.get<{ unread: number }>('/notifications/unread-count').then((r) => r.data),
  markRead: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.patch<{ updated: number }>('/notifications/read-all').then((r) => r.data),
  remove: (id: string) => api.delete<{ message: string }>(`/notifications/${id}`).then((r) => r.data),
};

// ------------------------------------------------------------------------- GIS

export interface MapQuery {
  featureTypes?: string;
  forestId?: string;
  minLat?: number;
  minLng?: number;
  maxLat?: number;
  maxLng?: number;
  limit?: number;
}

export const gisApi = {
  map: (query: MapQuery = {}) => api.get<GisMapPayload>('/gis/map', { params: query as never }).then((r) => r.data),
  fullMap: (query: MapQuery = {}) => api.get<GisMapPayload>('/gis/map/full', { params: query as never }).then((r) => r.data),
  layers: () => api.get<GisLayerInfo>('/gis/layers').then((r) => r.data),
  nearby: (params: { latitude: number; longitude: number; radiusKm?: number; featureTypes?: string; limit?: number }) =>
    api.get<NearbyResult[]>('/gis/nearby', { params }).then((r) => r.data),
  statistics: () => api.get<GisStatistics>('/gis/statistics').then((r) => r.data),
  recordPosition: (payload: { latitude: number; longitude: number; accuracyM?: number; elevationM?: number; source?: string; label?: string; capturedAt?: string; clientRef?: string; mocked?: boolean }) =>
    api.post<GisPosition>('/gis/positions', payload).then((r) => r.data),
  myPositions: (query: PageQuery & { from?: string; to?: string } = {}) => api.list<GisPosition>('/gis/positions/mine', { params: query as never }),
};

// ----------------------------------------------------------------------- audit

export const auditApi = {
  list: (query: PageQuery & { action?: string; severity?: string; actorId?: string; entityType?: string; from?: string; to?: string } = {}) =>
    api.list<AuditEntry>('/audit', { params: query as never }),
  summary: () => api.get<{ total: number; bySeverity: { severity: string; count: number }[]; byAction: { action: string; count: number }[] }>('/audit/summary').then((r) => r.data),
};

// ----------------------------------------------------------------------- files

export const filesApi = {
  /**
   * Uploads a device file to the storage module. `folder` must be one of the
   * server allowlist values (attachments, permits/documents, companies/documents,
   * inspections/evidence, activities/photos, observations/captures, reports/exports).
   */
  upload: async (file: { uri: string; name: string; mimeType: string }, folder: string) => {
    const form = new FormData();
    if (file.uri.startsWith('data:')) {
      // Web preview: the picker hands back a data URL — convert it to a Blob.
      const blob = await (await fetch(file.uri)).blob();
      form.append('file', blob, file.name);
    } else {
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    }
    return api
      .upload<{ key: string; url: string; mimeType: string; sizeBytes: number; originalName: string }>('/files/upload', form, {
        params: { folder },
      })
      .then((r) => r.data);
  },
  downloadUrl: (key: string) => api.buildUrl('/files/download', { key }),
};

// ---------------------------------------------------------------------- health

export const healthApi = {
  check: () => api.get<HealthStatus>('/health', { auth: false, retries: 0, timeoutMs: 8_000 }).then((r) => r.data),
};

export type { Paginated };
export type { Equipment, Evidence };
export type { GisFeature };
