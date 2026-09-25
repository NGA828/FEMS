/**
 * React Query hooks.
 *
 * Screens use these instead of calling endpoints directly so caching, refetching,
 * pagination and invalidation behave consistently. Mutations invalidate exactly
 * the collections they change — approving a permit refreshes the permit list,
 * the permit detail, the statistics and the dashboard counters.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  activitiesApi,
  aiApi,
  auditApi,
  authApi,
  companiesApi,
  filesApi,
  forestsApi,
  gisApi,
  healthApi,
  inspectionsApi,
  notificationsApi,
  observationsApi,
  paymentsApi,
  permitsApi,
  reportsApi,
  usersApi,
  violationsApi,
  type ActivityQuery,
  type AlertQuery,
  type CreateActivityPayload,
  type CreateInspectionPayload,
  type CreateObservationPayload,
  type ForestQuery,
  type InspectionQuery,
  type MapQuery,
  type ObservationQuery,
  type PageQuery,
  type PaymentQuery,
  type PermitQuery,
  type ReportQuery,
  type ViolationQuery,
} from './endpoints';
import type { CompanyStatus, NotificationPreference } from './types';

// ------------------------------------------------------------------ key space

export const queryKeys = {
  health: ['health'] as const,
  forests: (query?: unknown) => ['forests', query] as const,
  forest: (id: string) => ['forest', id] as const,
  forestZones: (id: string) => ['forest', id, 'zones'] as const,
  forestStatistics: ['forests', 'statistics'] as const,
  protectedAreas: (query?: unknown) => ['protected-areas', query] as const,
  permits: (query?: unknown) => ['permits', query] as const,
  permit: (id: string) => ['permit', id] as const,
  permitActions: (id: string) => ['permit', id, 'actions'] as const,
  permitTimeline: (id: string) => ['permit', id, 'timeline'] as const,
  permitDocuments: (id: string) => ['permit', id, 'documents'] as const,
  permitStatistics: ['permits', 'statistics'] as const,
  activities: (query?: unknown) => ['activities', query] as const,
  activity: (id: string) => ['activity', id] as const,
  activityStatistics: (query?: unknown) => ['activities', 'statistics', query] as const,
  equipment: (query?: unknown) => ['equipment', query] as const,
  payments: (query?: unknown) => ['payments', query] as const,
  payment: (id: string) => ['payment', id] as const,
  paymentProvider: ['payments', 'provider'] as const,
  paymentStatistics: ['payments', 'statistics'] as const,
  receipt: (id: string) => ['payment', id, 'receipt'] as const,
  inspections: (query?: unknown) => ['inspections', query] as const,
  inspection: (id: string) => ['inspection', id] as const,
  inspectionStatistics: ['inspections', 'statistics'] as const,
  observations: (query?: unknown) => ['observations', query] as const,
  observation: (id: string) => ['observation', id] as const,
  violations: (query?: unknown) => ['violations', query] as const,
  violation: (id: string) => ['violation', id] as const,
  violationStatistics: ['violations', 'statistics'] as const,
  alerts: (query?: unknown) => ['alerts', query] as const,
  alert: (id: string) => ['alert', id] as const,
  alertStatistics: ['alerts', 'statistics'] as const,
  analyses: (query?: unknown) => ['analyses', query] as const,
  analysis: (id: string) => ['analysis', id] as const,
  aiStatus: ['ai', 'status'] as const,
  aiCatalogue: ['ai', 'catalogue'] as const,
  conversations: (query?: unknown) => ['ai', 'conversations', query] as const,
  conversation: (id: string) => ['ai', 'conversation', id] as const,
  reports: (query?: unknown) => ['reports', query] as const,
  report: (id: string) => ['report', id] as const,
  reportCatalogue: ['reports', 'catalogue'] as const,
  reportStatistics: ['reports', 'statistics'] as const,
  notifications: (query?: unknown) => ['notifications', query] as const,
  unreadCount: ['notifications', 'unread'] as const,
  gisMap: (query?: unknown) => ['gis', 'map', query] as const,
  gisLayers: ['gis', 'layers'] as const,
  gisStatistics: ['gis', 'statistics'] as const,
  nearby: (query?: unknown) => ['gis', 'nearby', query] as const,
  myPositions: (query?: unknown) => ['gis', 'positions', query] as const,
  companies: (query?: unknown) => ['companies', query] as const,
  company: (id: string) => ['company', id] as const,
  myCompany: ['companies', 'me'] as const,
  companyDocuments: (id: string) => ['company', id, 'documents'] as const,
  companyStatistics: ['companies', 'statistics'] as const,
  users: (query?: unknown) => ['users', query] as const,
  user: (id: string) => ['user', id] as const,
  roles: ['roles'] as const,
  roleList: ['roles', 'list'] as const,
  audit: (query?: unknown) => ['audit', query] as const,
  auditSummary: ['audit', 'summary'] as const,
  sessions: ['auth', 'sessions'] as const,
  notificationPreferences: ['auth', 'notification-preferences'] as const,
};

/** Invalidates every query under the given prefixes after a mutation. */
async function invalidate(client: QueryClient, keys: readonly (readonly unknown[])[]): Promise<void> {
  await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: key as unknown[] })));
}

// --------------------------------------------------------------- infrastructure

export function useHealthCheck(enabled = true) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: healthApi.check,
    enabled,
    staleTime: 30_000,
    retry: 0,
    refetchInterval: 60_000,
  });
}

// -------------------------------------------------------------------- forests

export function useForests(query: ForestQuery = {}) {
  return useQuery({ queryKey: queryKeys.forests(query), queryFn: () => forestsApi.list(query), staleTime: 60_000 });
}

export function useForest(id: string | null) {
  return useQuery({ queryKey: queryKeys.forest(id ?? ''), queryFn: () => forestsApi.get(id as string), enabled: Boolean(id) });
}

export function useForestZones(forestId: string | null) {
  return useQuery({
    queryKey: queryKeys.forestZones(forestId ?? ''),
    queryFn: () => forestsApi.zones(forestId as string),
    enabled: Boolean(forestId),
    staleTime: 120_000,
  });
}

export function useForestStatistics() {
  return useQuery({ queryKey: queryKeys.forestStatistics, queryFn: forestsApi.statistics, staleTime: 60_000 });
}

export function useProtectedAreas(query: PageQuery & { region?: string; type?: string } = {}) {
  return useQuery({ queryKey: queryKeys.protectedAreas(query), queryFn: () => forestsApi.protectedAreas(query), staleTime: 120_000 });
}

// -------------------------------------------------------------------- permits

export function usePermits(query: PermitQuery = {}) {
  return useQuery({ queryKey: queryKeys.permits(query), queryFn: () => permitsApi.list(query), staleTime: 30_000 });
}

export function usePermit(id: string | null) {
  return useQuery({ queryKey: queryKeys.permit(id ?? ''), queryFn: () => permitsApi.get(id as string), enabled: Boolean(id) });
}

export function usePermitActions(id: string | null) {
  return useQuery({
    queryKey: queryKeys.permitActions(id ?? ''),
    queryFn: () => permitsApi.actions(id as string),
    enabled: Boolean(id),
  });
}

export function usePermitTimeline(id: string | null) {
  return useQuery({
    queryKey: queryKeys.permitTimeline(id ?? ''),
    queryFn: () => permitsApi.timeline(id as string),
    enabled: Boolean(id),
  });
}

export function usePermitDocuments(id: string | null) {
  return useQuery({
    queryKey: queryKeys.permitDocuments(id ?? ''),
    queryFn: () => permitsApi.documents(id as string),
    enabled: Boolean(id),
  });
}

export function usePermitStatistics() {
  return useQuery({ queryKey: queryKeys.permitStatistics, queryFn: permitsApi.statistics, staleTime: 30_000 });
}

export function useCreatePermit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => permitsApi.create(payload),
    onSuccess: (permit) => invalidate(client, [queryKeys.permits(), queryKeys.permitStatistics, ['dashboard']]),
  });
}

export function usePermitAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: string; payload?: Record<string, unknown> }) => permitsApi.act(id, input.action, input.payload ?? {}),
    onSuccess: () =>
      invalidate(client, [
        queryKeys.permit(id),
        queryKeys.permitActions(id),
        queryKeys.permitTimeline(id),
        queryKeys.permits(),
        queryKeys.permitStatistics,
      ]),
  });
}

export function useRenewPermit(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => permitsApi.renew(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.permit(id), queryKeys.permits(), queryKeys.permitStatistics]),
  });
}

export function useAttachPermitDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { type: string; title: string; fileKey: string; mimeType: string; sizeBytes: number; checksum?: string; notes?: string }) =>
      permitsApi.addDocument(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.permitDocuments(id), queryKeys.permit(id)]),
  });
}

export function useVerifyPermitDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; isVerified: boolean; notes?: string }) =>
      permitsApi.verifyDocument(id, input.documentId, { isVerified: input.isVerified, notes: input.notes }),
    onSuccess: () => invalidate(client, [queryKeys.permitDocuments(id), queryKeys.permitTimeline(id)]),
  });
}

// --------------------------------------------------------------- exploitation

export function useActivities(query: ActivityQuery = {}) {
  return useQuery({ queryKey: queryKeys.activities(query), queryFn: () => activitiesApi.list(query), staleTime: 30_000 });
}

export function useActivity(id: string | null) {
  return useQuery({ queryKey: queryKeys.activity(id ?? ''), queryFn: () => activitiesApi.get(id as string), enabled: Boolean(id) });
}

export function useActivityStatistics(query: { forestId?: string; months?: number; topCompanies?: number } = {}) {
  return useQuery({ queryKey: queryKeys.activityStatistics(query), queryFn: () => activitiesApi.statistics(query), staleTime: 60_000 });
}

export function useEquipment(query: PageQuery & { status?: string; category?: string; companyId?: string } = {}) {
  return useQuery({ queryKey: queryKeys.equipment(query), queryFn: () => activitiesApi.equipment(query), staleTime: 60_000 });
}

export function useCreateActivity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateActivityPayload) => activitiesApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.activities(), queryKeys.permitStatistics]),
  });
}

export function useActivityAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: string; payload?: Record<string, unknown> }) => activitiesApi.act(id, input.action, input.payload ?? {}),
    onSuccess: () => invalidate(client, [queryKeys.activity(id), queryKeys.activities()]),
  });
}

export function useRecordHarvest(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { harvestedVolumeM3: number; harvestedTreeCount: number; speciesBreakdown?: Record<string, number>; observations?: string; clientRef?: string }) =>
      activitiesApi.recordHarvest(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.activity(id), queryKeys.activities(), queryKeys.activityStatistics()]),
  });
}

export function useAttachEquipment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { equipmentId: string; hoursUsed?: number; volumeM3?: number; notes?: string }) =>
      activitiesApi.attachEquipment(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.activity(id), queryKeys.equipment()]),
  });
}

export function useCreateEquipment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => activitiesApi.createEquipment(payload),
    onSuccess: () => invalidate(client, [queryKeys.equipment()]),
  });
}

// ------------------------------------------------------------------- payments

export function usePayments(query: PaymentQuery = {}) {
  return useQuery({ queryKey: queryKeys.payments(query), queryFn: () => paymentsApi.list(query), staleTime: 20_000 });
}

export function usePayment(id: string | null) {
  return useQuery({
    queryKey: queryKeys.payment(id ?? ''),
    queryFn: () => paymentsApi.get(id as string),
    enabled: Boolean(id),
    // A payment can settle on the provider side at any moment: poll while it is
    // still pending so the status the user sees is the one the backend verified.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 8_000 : false;
    },
  });
}

export function usePaymentProvider() {
  return useQuery({ queryKey: queryKeys.paymentProvider, queryFn: paymentsApi.provider, staleTime: 300_000 });
}

export function usePaymentStatistics() {
  return useQuery({ queryKey: queryKeys.paymentStatistics, queryFn: paymentsApi.statistics, staleTime: 30_000 });
}

export function usePaymentReceipt(id: string | null) {
  return useQuery({
    queryKey: queryKeys.receipt(id ?? ''),
    queryFn: () => paymentsApi.receipt(id as string),
    enabled: Boolean(id),
  });
}

export function useInitiatePayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof paymentsApi.initiate>[0]) => paymentsApi.initiate(payload),
    onSuccess: () => invalidate(client, [queryKeys.payments(), queryKeys.paymentStatistics, queryKeys.permits()]),
  });
}

export function useVerifyPayment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notes?: string) => paymentsApi.verify(id, notes),
    onSuccess: () => invalidate(client, [queryKeys.payment(id), queryKeys.payments(), queryKeys.paymentStatistics]),
  });
}

export function useSimulatePayment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { outcome: 'SUCCESSFUL' | 'FAILED' | 'CANCELLED'; notes?: string }) =>
      paymentsApi.simulate(id, input.outcome, input.notes),
    onSuccess: () => invalidate(client, [queryKeys.payment(id), queryKeys.payments(), queryKeys.paymentStatistics]),
  });
}

export function useRefundPayment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => paymentsApi.refund(id, reason),
    onSuccess: () => invalidate(client, [queryKeys.payment(id), queryKeys.payments(), queryKeys.paymentStatistics]),
  });
}

// ----------------------------------------------------------------- inspections

export function useInspections(query: InspectionQuery = {}) {
  return useQuery({ queryKey: queryKeys.inspections(query), queryFn: () => inspectionsApi.list(query), staleTime: 30_000 });
}

export function useInspection(id: string | null) {
  return useQuery({ queryKey: queryKeys.inspection(id ?? ''), queryFn: () => inspectionsApi.get(id as string), enabled: Boolean(id) });
}

export function useInspectionStatistics() {
  return useQuery({ queryKey: queryKeys.inspectionStatistics, queryFn: inspectionsApi.statistics, staleTime: 60_000 });
}

export function useCreateInspection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateInspectionPayload) => inspectionsApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.inspections(), queryKeys.inspectionStatistics]),
  });
}

export function useStartInspection(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { latitude: number; longitude: number; locationAccuracyM?: number; gpsSource?: string; gpsCapturedAt?: string }) =>
      inspectionsApi.start(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.inspection(id), queryKeys.inspections()]),
  });
}

export function useSubmitInspection(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof inspectionsApi.submit>[1]) => inspectionsApi.submit(id, payload),
    onSuccess: () =>
      invalidate(client, [queryKeys.inspection(id), queryKeys.inspections(), queryKeys.inspectionStatistics]),
  });
}

export function useReviewInspection(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { outcome?: string; notes?: string; recommendations?: string }) => inspectionsApi.review(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.inspection(id), queryKeys.inspections(), queryKeys.inspectionStatistics]),
  });
}

export function useCloseInspection(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { summary?: string }) => inspectionsApi.close(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.inspection(id), queryKeys.inspections(), queryKeys.inspectionStatistics]),
  });
}

export function useCancelInspection(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => inspectionsApi.cancel(id, reason),
    onSuccess: () => invalidate(client, [queryKeys.inspection(id), queryKeys.inspections()]),
  });
}

export function useAttachEvidence(scope: { inspectionId?: string; observationId?: string; activityId?: string; violationId?: string }) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => inspectionsApi.attachEvidence(payload),
    onSuccess: () =>
      invalidate(client, [
        queryKeys.inspection(scope.inspectionId ?? ''),
        queryKeys.observation(scope.observationId ?? ''),
        queryKeys.activity(scope.activityId ?? ''),
        queryKeys.violation(scope.violationId ?? ''),
      ]),
  });
}

// ---------------------------------------------------------------- observations

export function useObservations(query: ObservationQuery = {}) {
  return useQuery({ queryKey: queryKeys.observations(query), queryFn: () => observationsApi.list(query), staleTime: 30_000 });
}

export function useObservation(id: string | null) {
  return useQuery({ queryKey: queryKeys.observation(id ?? ''), queryFn: () => observationsApi.get(id as string), enabled: Boolean(id) });
}

export function useCreateObservation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateObservationPayload) => observationsApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.observations()]),
  });
}

export function useUpdateObservation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => observationsApi.update(id, payload),
    onSuccess: () => invalidate(client, [queryKeys.observation(id), queryKeys.observations()]),
  });
}

export function useDeleteObservation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => observationsApi.remove(id),
    onSuccess: () => invalidate(client, [queryKeys.observations()]),
  });
}

// ------------------------------------------------------------------ violations

export function useViolations(query: ViolationQuery = {}) {
  return useQuery({ queryKey: queryKeys.violations(query), queryFn: () => violationsApi.list(query), staleTime: 30_000 });
}

export function useViolation(id: string | null) {
  return useQuery({ queryKey: queryKeys.violation(id ?? ''), queryFn: () => violationsApi.get(id as string), enabled: Boolean(id) });
}

export function useViolationStatistics() {
  return useQuery({ queryKey: queryKeys.violationStatistics, queryFn: violationsApi.statistics, staleTime: 60_000 });
}

export function useCreateViolation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => violationsApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.violations(), queryKeys.violationStatistics]),
  });
}

export function useViolationAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: string; payload?: Record<string, unknown> }) =>
      violationsApi.act(id, input.action, input.payload ?? {}),
    onSuccess: () =>
      invalidate(client, [
        queryKeys.violation(id),
        queryKeys.violations(),
        queryKeys.violationStatistics,
        queryKeys.payments(),
      ]),
  });
}

// -------------------------------------------------------------------------- AI

export function useAiStatus() {
  return useQuery({ queryKey: queryKeys.aiStatus, queryFn: aiApi.status, staleTime: 30_000 });
}

export function useAiCatalogue() {
  return useQuery({ queryKey: queryKeys.aiCatalogue, queryFn: aiApi.catalogue, staleTime: 300_000 });
}

export function useAlerts(query: AlertQuery = {}) {
  return useQuery({ queryKey: queryKeys.alerts(query), queryFn: () => aiApi.alerts(query), staleTime: 20_000 });
}

export function useAlert(id: string | null) {
  return useQuery({ queryKey: queryKeys.alert(id ?? ''), queryFn: () => aiApi.alert(id as string), enabled: Boolean(id) });
}

export function useAlertStatistics() {
  return useQuery({ queryKey: queryKeys.alertStatistics, queryFn: aiApi.alertStatistics, staleTime: 30_000 });
}

export function useAnalyses(query: PageQuery & { type?: string; status?: string; forestId?: string } = {}) {
  return useQuery({ queryKey: queryKeys.analyses(query), queryFn: () => aiApi.analyses(query), staleTime: 30_000 });
}

export function useAnalysis(id: string | null) {
  return useQuery({ queryKey: queryKeys.analysis(id ?? ''), queryFn: () => aiApi.analysis(id as string), enabled: Boolean(id) });
}

export function useReviewAlert(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof aiApi.reviewAlert>[1]) => aiApi.reviewAlert(id, payload),
    onSuccess: () =>
      invalidate(client, [
        queryKeys.alert(id),
        queryKeys.alerts(),
        queryKeys.alertStatistics,
        queryKeys.violations(),
        queryKeys.inspections(),
      ]),
  });
}

export function useRunAnalysis() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof aiApi.runAnalysis>[0]) => aiApi.runAnalysis(payload),
    onSuccess: () => invalidate(client, [queryKeys.analyses(), queryKeys.alerts(), queryKeys.alertStatistics]),
  });
}

export function useConversations(query: PageQuery & { includeArchived?: 'true' | 'false' } = {}) {
  return useQuery({ queryKey: queryKeys.conversations(query), queryFn: () => aiApi.conversations(query), staleTime: 30_000 });
}

export function useConversation(id: string | null) {
  return useQuery({ queryKey: queryKeys.conversation(id ?? ''), queryFn: () => aiApi.conversation(id as string), enabled: Boolean(id) });
}

export function useAskAssistant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof aiApi.ask>[0]) => aiApi.ask(payload),
    onSuccess: (answer) => invalidate(client, [queryKeys.conversations(), queryKeys.conversation(answer.conversationId)]),
  });
}

export function useArchiveConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => aiApi.archiveConversation(id),
    onSuccess: () => invalidate(client, [queryKeys.conversations()]),
  });
}

export function useDeleteConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => aiApi.deleteConversation(id),
    onSuccess: () => invalidate(client, [queryKeys.conversations()]),
  });
}

// --------------------------------------------------------------------- reports

export function useReports(query: ReportQuery = {}) {
  return useQuery({ queryKey: queryKeys.reports(query), queryFn: () => reportsApi.list(query), staleTime: 30_000 });
}

export function useReport(id: string | null) {
  return useQuery({
    queryKey: queryKeys.report(id ?? ''),
    queryFn: () => reportsApi.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'GENERATING' ? 5_000 : false),
  });
}

export function useReportCatalogue() {
  return useQuery({ queryKey: queryKeys.reportCatalogue, queryFn: reportsApi.catalogue, staleTime: 600_000 });
}

export function useReportStatistics() {
  return useQuery({ queryKey: queryKeys.reportStatistics, queryFn: reportsApi.statistics, staleTime: 60_000 });
}

export function useGenerateReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof reportsApi.create>[0]) => reportsApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.reports(), queryKeys.reportStatistics, queryKeys.notifications()]),
  });
}

/**
 * Shares a ready report. The report id travels with the call so a library screen
 * can share whichever row the user picked without creating a hook per row.
 */
export function useSendReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; payload: { audience?: 'OFFICERS' | 'COMPANIES'; message?: string } }) =>
      reportsApi.send(input.id, input.payload),
    onSuccess: (_result, input) => invalidate(client, [queryKeys.report(input.id), queryKeys.reports(), queryKeys.notifications()]),
  });
}

/** Builds the dataset behind a report type without storing a file. */
export function useReportPreview() {
  return useMutation({
    mutationFn: (payload: Parameters<typeof reportsApi.preview>[0]) => reportsApi.preview(payload),
  });
}

export function useDeleteReport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => invalidate(client, [queryKeys.reports(), queryKeys.reportStatistics]),
  });
}

// --------------------------------------------------------------- notifications

export function useNotifications(query: PageQuery & { unreadOnly?: boolean; type?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.notifications(query),
    queryFn: () => notificationsApi.list(query),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: notificationsApi.unreadCount,
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => invalidate(client, [queryKeys.notifications(), queryKeys.unreadCount]),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => invalidate(client, [queryKeys.notifications(), queryKeys.unreadCount]),
  });
}

// ------------------------------------------------------------------------- GIS

export function useGisLayers() {
  return useQuery({ queryKey: queryKeys.gisLayers, queryFn: gisApi.layers, staleTime: 60_000 });
}

export function useGisMap(query: MapQuery = {}) {
  return useQuery({ queryKey: queryKeys.gisMap(query), queryFn: () => gisApi.map(query), staleTime: 30_000 });
}

export function useGisStatistics() {
  return useQuery({ queryKey: queryKeys.gisStatistics, queryFn: gisApi.statistics, staleTime: 60_000 });
}

export function useNearby(params: { latitude: number; longitude: number; radiusKm?: number; featureTypes?: string } | null) {
  return useQuery({
    queryKey: queryKeys.nearby(params),
    queryFn: () => gisApi.nearby(params as { latitude: number; longitude: number }),
    enabled: Boolean(params),
    staleTime: 20_000,
  });
}

export function useMyPositions(query: PageQuery = {}) {
  return useQuery({ queryKey: queryKeys.myPositions(query), queryFn: () => gisApi.myPositions(query), staleTime: 30_000 });
}

export function useRecordPosition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof gisApi.recordPosition>[0]) => gisApi.recordPosition(payload),
    onSuccess: () => invalidate(client, [queryKeys.myPositions(), queryKeys.gisStatistics]),
  });
}

// -------------------------------------------------------- companies and users

export function useCompanies(query: PageQuery & { status?: string; type?: string; region?: string } = {}) {
  return useQuery({ queryKey: queryKeys.companies(query), queryFn: () => companiesApi.list(query), staleTime: 60_000 });
}

export function useCompany(id: string | null) {
  return useQuery({ queryKey: queryKeys.company(id ?? ''), queryFn: () => companiesApi.get(id as string), enabled: Boolean(id) });
}

export function useMyCompany(enabled = true) {
  return useQuery({ queryKey: queryKeys.myCompany, queryFn: companiesApi.mine, enabled, retry: 0 });
}

export function useCompanyDocuments(id: string | null) {
  return useQuery({
    queryKey: queryKeys.companyDocuments(id ?? ''),
    queryFn: () => companiesApi.documents(id as string),
    enabled: Boolean(id),
  });
}

export function useVerifyCompany() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; approved: boolean; rejectionReason?: string; notes?: string }) =>
      companiesApi.verify(input.id, {
        approved: input.approved,
        rejectionReason: input.rejectionReason,
        notes: input.notes,
      }),
    onSuccess: (_result, input) =>
      invalidate(client, [queryKeys.companies(), queryKeys.company(input.id), queryKeys.myCompany, queryKeys.companyStatistics]),
  });
}

/** Suspends or restores a company registration; the reason is audited. */
export function useSetCompanyStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: CompanyStatus; reason: string }) => companiesApi.setStatus(input.id, { status: input.status, reason: input.reason }),
    onSuccess: (_result, input) =>
      invalidate(client, [queryKeys.companies(), queryKeys.company(input.id), queryKeys.companyStatistics]),
  });
}

export function useAddCompanyDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof companiesApi.addDocument>[1] & { companyId: string }) => {
      const { companyId, ...payload } = input;
      return companiesApi.addDocument(companyId, payload);
    },
    onSuccess: (_result, input) => invalidate(client, [queryKeys.companyDocuments(input.companyId), queryKeys.company(input.companyId)]),
  });
}

export function useVerifyCompanyDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; documentId: string; isVerified: boolean; notes?: string }) =>
      companiesApi.verifyDocument(input.companyId, input.documentId, { isVerified: input.isVerified, notes: input.notes }),
    onSuccess: (_result, input) => invalidate(client, [queryKeys.companyDocuments(input.companyId), queryKeys.company(input.companyId)]),
  });
}

export function useRemoveCompanyDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; documentId: string }) => companiesApi.removeDocument(input.companyId, input.documentId),
    onSuccess: (_result, input) => invalidate(client, [queryKeys.companyDocuments(input.companyId), queryKeys.company(input.companyId)]),
  });
}

export function useCompanyStatistics() {
  return useQuery({ queryKey: queryKeys.companyStatistics, queryFn: companiesApi.statistics, staleTime: 60_000 });
}

export function useUsers(query: PageQuery & { role?: string; status?: string } = {}) {
  return useQuery({ queryKey: queryKeys.users(query), queryFn: () => usersApi.list(query), staleTime: 30_000 });
}

export function useUser(id: string | null) {
  return useQuery({ queryKey: queryKeys.user(id ?? ''), queryFn: () => usersApi.get(id as string), enabled: Boolean(id) });
}

export function useRoles() {
  return useQuery({ queryKey: queryKeys.roles, queryFn: usersApi.roles, staleTime: 600_000 });
}

/** Roles with their permission grants and how many accounts hold them. */
export function useRoleList() {
  return useQuery({ queryKey: queryKeys.roleList, queryFn: usersApi.roleList, staleTime: 600_000 });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => usersApi.create(payload),
    onSuccess: () => invalidate(client, [queryKeys.users()]),
  });
}

export function useSetUserStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: string; reason?: string }) => usersApi.setStatus(input.id, input.status, input.reason),
    onSuccess: (_data, variables) => invalidate(client, [queryKeys.users(), queryKeys.user(variables.id)]),
  });
}

export function useResetUserPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; newPassword?: string }) => usersApi.resetPassword(input.id, input.newPassword),
    onSuccess: () => invalidate(client, [queryKeys.users()]),
  });
}

// ----------------------------------------------------------------------- audit

export function useAuditLog(
  query: PageQuery & {
    action?: string;
    severity?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {},
) {
  return useQuery({ queryKey: queryKeys.audit(query), queryFn: () => auditApi.list(query), staleTime: 30_000 });
}

export function useAuditSummary(days?: number) {
  return useQuery({ queryKey: [...queryKeys.auditSummary, days ?? 30], queryFn: () => auditApi.summary(days), staleTime: 60_000 });
}

export function useUpdateEquipment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; payload: Record<string, unknown> }) => activitiesApi.updateEquipment(input.id, input.payload),
    onSuccess: () => invalidate(client, [queryKeys.equipment()]),
  });
}

export function useDeleteEquipment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => activitiesApi.deleteEquipment(id),
    onSuccess: () => invalidate(client, [queryKeys.equipment()]),
  });
}

// ------------------------------------------------------------------ preferences

export function useNotificationPreferences() {
  return useQuery({ queryKey: queryKeys.notificationPreferences, queryFn: authApi.notificationPreferences, staleTime: 300_000 });
}

export function useUpdateNotificationPreference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preference: NotificationPreference) => authApi.updateNotificationPreference(preference),
    onSuccess: () => invalidate(client, [queryKeys.notificationPreferences]),
  });
}

// ----------------------------------------------------------------------- files

export function useUploadFile() {
  return useMutation({
    mutationFn: (input: { file: { uri: string; name: string; mimeType: string }; folder: string }) =>
      filesApi.upload(input.file, input.folder),
  });
}

// -------------------------------------------------------------------- profile

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (payload: { firstName?: string; lastName?: string; phone?: string; jobTitle?: string; preferredLanguage?: string }) =>
      authApi.updateProfile(payload),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(input.currentPassword, input.newPassword),
  });
}

export function useSessions() {
  return useQuery({ queryKey: queryKeys.sessions, queryFn: authApi.sessions, staleTime: 30_000 });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSuccess: () => invalidate(client, [queryKeys.sessions]),
  });
}
