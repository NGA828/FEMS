/**
 * Domain types mirroring the FEMS API contract.
 *
 * Field names and enum values are identical to the backend DTOs and Prisma enums
 * (see `fems-backend/prisma/schema.prisma`), so a response can be rendered
 * without a translation layer. Everything optional is genuinely optional in the
 * API response — nothing here is a mock.
 */

export type Identifier = string;
export type IsoDate = string;
export type Numeric = string | number;

export interface PaginationMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  [key: string]: unknown;
}

// ------------------------------------------------------------------- identity

export type RoleName =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'GOVERNMENT_FOREST_OFFICER'
  | 'ENVIRONMENTAL_OFFICER'
  | 'FOREST_INSPECTOR'
  | 'FIELD_OPERATOR'
  | 'COMPANY_REPRESENTATIVE'
  | 'FOREST_EXPLORER'
  | 'VISITOR';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface RoleSummary {
  name: RoleName;
  label: string;
  level: number;
  assignedAt?: IsoDate;
  expiresAt?: IsoDate | null;
}

export interface AuthUser {
  id: Identifier;
  email: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  phone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  status: UserStatus;
  emailVerified?: boolean;
  preferredLanguage?: string;
  isDemo?: boolean;
  lastLoginAt?: IsoDate | null;
  createdAt?: IsoDate;
  roles: RoleSummary[];
  permissions: string[];
  company?: CompanySummary | null;
}

export interface CompanySummary {
  id: Identifier;
  name: string;
  status?: CompanyStatus;
  type?: CompanyType;
}

export interface AuthSession {
  user: AuthUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn?: number; tokenType?: string };
}

export interface DirectoryUser {
  id: Identifier;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  status: UserStatus;
  isDemo?: boolean;
  preferredLanguage?: string;
  emailVerifiedAt?: IsoDate | null;
  lastLoginAt?: IsoDate | null;
  createdAt: IsoDate;
  updatedAt?: IsoDate;
  companyId?: Identifier | null;
  company?: CompanySummary | null;
  roles: RoleSummary[];
}

// ------------------------------------------------------------------- companies

export type CompanyType =
  | 'LOGGING_COMPANY'
  | 'TIMBER_TRADER'
  | 'SAWMILL'
  | 'ARTISANAL'
  | 'COOPERATIVE'
  | 'WOOD_PROCESSING'
  | 'OTHER';

export type CompanyStatus = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'REJECTED';

export interface Company {
  id: Identifier;
  name: string;
  registrationNumber: string;
  taxNumber?: string | null;
  type: CompanyType;
  status: CompanyStatus;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  website?: string | null;
  longitude?: Numeric | null;
  latitude?: Numeric | null;
  employeeCount?: number | null;
  description?: string | null;
  verifiedAt?: IsoDate | null;
  rejectionReason?: string | null;
  ownerId?: Identifier | null;
  isDemo?: boolean;
  createdAt: IsoDate;
  _count?: { permits?: number; activities?: number; members?: number; documents?: number };
}

// --------------------------------------------------------------------- forests

export type ForestType = 'PRODUCTION' | 'PROTECTION' | 'COMMUNITY' | 'REGENERATION' | 'PLANTATION' | 'MIXED';
export type ForestStatus = 'ACTIVE' | 'UNDER_MANAGEMENT' | 'DEGRADED' | 'PROTECTED' | 'CLOSED';
export type ZoneType = 'PRODUCTION' | 'PROTECTION' | 'CONSERVATION' | 'COMMUNITY' | 'REGENERATION' | 'BUFFER' | 'SACRED';
export type ProtectedAreaType =
  | 'NATIONAL_PARK'
  | 'WILDLIFE_RESERVE'
  | 'FOREST_RESERVE'
  | 'COMMUNITY_FOREST'
  | 'BIOSPHERE_RESERVE'
  | 'SANCTUARY'
  | 'RAMSAR_SITE';

export interface ForestZone {
  id: Identifier;
  code: string;
  name: string;
  type: ZoneType;
  status?: string;
  areaHa?: Numeric;
  forestId: Identifier;
  _count?: Record<string, number>;
}

export interface Forest {
  id: Identifier;
  code: string;
  name: string;
  description?: string | null;
  type: ForestType;
  status: ForestStatus;
  region: string;
  division?: string | null;
  subdivision?: string | null;
  totalAreaHa: Numeric;
  exploitableAreaHa?: Numeric | null;
  latitude: Numeric;
  longitude: Numeric;
  elevationM?: number | null;
  annualAllowableCutM3?: Numeric | null;
  establishedAt?: IsoDate | null;
  lastInventoriedAt?: IsoDate | null;
  isPublic?: boolean;
  isDemo?: boolean;
  protectedAreaId?: Identifier | null;
  managedById?: Identifier | null;
  createdAt?: IsoDate;
  protectedArea?: { id: Identifier; name: string; type: ProtectedAreaType } | null;
  managedBy?: CompanySummary | null;
  _count?: { zones?: number; permits?: number; activities?: number; inventories?: number };
}

export interface ProtectedArea {
  id: Identifier;
  code: string;
  name: string;
  type: ProtectedAreaType;
  status?: string;
  region: string;
  areaHa: Numeric;
  latitude: Numeric;
  longitude: Numeric;
  establishedAt?: IsoDate | null;
  managingAuthority?: string | null;
  description?: string | null;
  biodiversityNotes?: string | null;
  encroachmentRisk?: string | null;
  isDemo?: boolean;
  _count?: { forests?: number; violations?: number; observations?: number };
}

// --------------------------------------------------------------------- permits

export type PermitType =
  | 'EXPLOITATION'
  | 'TRANSPORT'
  | 'PROCESSING'
  | 'EXPORT'
  | 'ARTISANAL'
  | 'RECONNAISSANCE'
  | 'COMMUNITY_FOREST';

export type PermitStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'REVISION_REQUIRED'
  | 'REJECTED'
  | 'APPROVED'
  | 'PAYMENT_PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'CANCELLED';

export type PermitPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type DocumentType =
  | 'COMPANY_REGISTRATION'
  | 'TAX_CLEARANCE'
  | 'ENVIRONMENTAL_IMPACT_ASSESSMENT'
  | 'MANAGEMENT_PLAN'
  | 'LAND_TITLE'
  | 'IDENTITY_DOCUMENT'
  | 'EXPLOITATION_LICENCE'
  | 'TRANSPORT_PERMIT'
  | 'OTHER';

export interface PermitDocument {
  id: Identifier;
  permitId: Identifier;
  type: DocumentType;
  title: string;
  fileKey: string;
  fileUrl?: string | null;
  mimeType: string;
  sizeBytes: number;
  checksum?: string | null;
  isVerified: boolean;
  verifiedById?: Identifier | null;
  verifiedAt?: IsoDate | null;
  notes?: string | null;
  createdAt?: IsoDate;
}

export interface Permit {
  id: Identifier;
  permitNumber: string;
  type: PermitType;
  status: PermitStatus;
  priority?: PermitPriority;
  title: string;
  purpose?: string | null;
  companyId: Identifier;
  applicantId?: Identifier;
  forestId: Identifier;
  zoneId?: Identifier | null;
  volumeRequestedM3: Numeric;
  volumeApprovedM3?: Numeric | null;
  areaRequestedHa?: Numeric | null;
  currency?: string;
  feeAmount?: Numeric | null;
  royaltyRatePerM3?: Numeric | null;
  startDate: IsoDate;
  endDate: IsoDate;
  submittedAt?: IsoDate | null;
  reviewStartedAt?: IsoDate | null;
  reviewedAt?: IsoDate | null;
  approvedAt?: IsoDate | null;
  activatedAt?: IsoDate | null;
  suspendedAt?: IsoDate | null;
  suspensionReason?: string | null;
  revokedAt?: IsoDate | null;
  revocationReason?: string | null;
  rejectionReason?: string | null;
  revisionNotes?: string | null;
  revisionCount?: number;
  expiresAt?: IsoDate | null;
  previousPermitId?: Identifier | null;
  renewalCount?: number;
  conditions?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  updatedAt?: IsoDate;
  company?: CompanySummary;
  applicant?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  forest?: Pick<Forest, 'id' | 'code' | 'name' | 'region'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  reviewedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  approvedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  _count?: { documents?: number; activities?: number; payments?: number; inspections?: number; violations?: number };
}

export interface PermitTimelineEntry {
  id: Identifier;
  permitId: Identifier;
  fromStatus: PermitStatus | null;
  toStatus: PermitStatus;
  changedById?: Identifier;
  reason?: string | null;
  createdAt: IsoDate;
  changedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
}

export interface PermitAction {
  action: string;
  label: string;
  description: string;
  targetStatus: PermitStatus;
  requiresReason: boolean;
}

export interface PermitActionsPayload {
  status: PermitStatus;
  outstandingBalance: number;
  actions: PermitAction[];
}

// ---------------------------------------------------------------- exploitation

export type ActivityType =
  | 'TIMBER_HARVEST'
  | 'LOG_TRANSPORT'
  | 'SITE_CLEARING'
  | 'PLANTING'
  | 'FOREST_SURVEY'
  | 'ROAD_CONSTRUCTION'
  | 'MAINTENANCE'
  | 'SALVAGE_LOGGING';
export type ActivityStatus = 'PLANNED' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'SUSPENDED' | 'CANCELLED';
export type GpsSource = 'DEVICE_GPS' | 'MANUAL_CORRECTION' | 'SYSTEM_RECORDED' | 'SEED_DEMO';
export type SyncStatus = 'SYNCED' | 'PENDING_SYNC' | 'FAILED';
export type EquipmentCategory =
  | 'HARVESTER'
  | 'CHAINSAW'
  | 'LOGGING_TRUCK'
  | 'TRACTOR'
  | 'SKIDDER'
  | 'LOG_LOADER'
  | 'BULLDOZER'
  | 'DRONE'
  | 'SURVEY_EQUIPMENT'
  | 'OTHER';
export type EquipmentStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export interface Equipment {
  id: Identifier;
  companyId: Identifier;
  name: string;
  category: EquipmentCategory;
  status: EquipmentStatus;
  registrationNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  capacityM3?: Numeric | null;
  operatorName?: string | null;
  notes?: string | null;
  isDemo?: boolean;
  company?: CompanySummary | null;
  _count?: { usage?: number };
}

export interface ExploitationActivity {
  id: Identifier;
  reference: string;
  permitId: Identifier;
  companyId: Identifier;
  forestId: Identifier;
  zoneId?: Identifier | null;
  activityType: ActivityType;
  status: ActivityStatus;
  plannedVolumeM3: Numeric;
  harvestedVolumeM3?: Numeric | null;
  harvestedTreeCount?: number | null;
  plannedStartDate: IsoDate;
  plannedEndDate?: IsoDate | null;
  actualStartDate?: IsoDate | null;
  actualEndDate?: IsoDate | null;
  latitude: Numeric;
  longitude: Numeric;
  locationAccuracyM?: Numeric | null;
  gpsCapturedAt?: IsoDate | null;
  gpsSource?: GpsSource;
  equipmentSummary?: string | null;
  observations?: string | null;
  speciesBreakdownJson?: string | null;
  syncStatus?: SyncStatus;
  clientRef?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  permit?: Pick<Permit, 'id' | 'permitNumber' | 'status' | 'companyId'> | null;
  company?: CompanySummary | null;
  forest?: Pick<Forest, 'id' | 'code' | 'name' | 'region'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  createdBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  assignedTo?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  equipmentUsage?: { id: Identifier; equipment?: Equipment | null }[];
}

// -------------------------------------------------------------------- payments

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type PaymentMethod =
  | 'MOBILE_MONEY_MTN'
  | 'MOBILE_MONEY_ORANGE'
  | 'MOBILE_MONEY_AIRTEL'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'CASH';
export type PaymentPurpose = 'PERMIT_FEE' | 'ROYALTY' | 'ANNUAL_TAX' | 'PENALTY' | 'REPLANTING_BOND' | 'OTHER';

export interface Payment {
  id: Identifier;
  reference: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  provider?: 'CAMPAY' | 'SIMULATOR' | string;
  method: PaymentMethod;
  amount: Numeric;
  currency?: string;
  providerReference?: string | null;
  providerPhone?: string | null;
  receiptNumber?: string | null;
  failureReason?: string | null;
  initiatedAt?: IsoDate;
  processedAt?: IsoDate | null;
  paidAt?: IsoDate | null;
  verifiedAt?: IsoDate | null;
  refundedAt?: IsoDate | null;
  payerId?: Identifier;
  companyId?: Identifier | null;
  permitId?: Identifier | null;
  violationId?: Identifier | null;
  notes?: string | null;
  syncStatus?: SyncStatus;
  clientRef?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  payer?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  company?: CompanySummary | null;
  permit?: Pick<Permit, 'id' | 'permitNumber' | 'status'> | null;
  violation?: { id: Identifier; reference: string; status: string; penaltyAmountXAF?: Numeric | null } | null;
  initiatedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  verifiedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
}

export interface PaymentProviderInfo {
  provider: 'CAMPAY' | 'SIMULATOR' | string;
  sandbox: boolean;
  configured: boolean;
  missing: string[];
  currency: string;
  webhookConfigured: boolean;
  message: string;
}

// ----------------------------------------------------------------- inspections

export type InspectionType = 'ROUTINE' | 'COMPLIANCE' | 'ENVIRONMENTAL' | 'POST_ACTIVITY' | 'INCIDENT' | 'VERIFICATION';
export type InspectionStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'SUBMITTED' | 'REVIEWED' | 'CLOSED' | 'CANCELLED';
export type InspectionOutcome = 'COMPLIANT' | 'MINOR_NON_COMPLIANCE' | 'MAJOR_NON_COMPLIANCE' | 'CRITICAL_NON_COMPLIANCE';
export type ChecklistResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
export type EvidenceType = 'PHOTO' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'SIGNATURE';
export type EvidenceSource = 'DEVICE_CAMERA' | 'DEVICE_LIBRARY' | 'SCANNER' | 'UPLOAD' | 'SYSTEM';

export interface ChecklistItem {
  id?: Identifier;
  inspectionId?: Identifier;
  code: string;
  label: string;
  result: ChecklistResult;
  notes?: string | null;
  sortOrder?: number;
}

export interface Evidence {
  id: Identifier;
  type: EvidenceType;
  source?: EvidenceSource;
  fileKey: string;
  fileUrl?: string | null;
  mimeType: string;
  sizeBytes: number;
  title?: string | null;
  caption?: string | null;
  checksum?: string | null;
  latitude?: Numeric | null;
  longitude?: Numeric | null;
  locationAccuracyM?: Numeric | null;
  gpsSource?: GpsSource;
  capturedAt?: IsoDate | null;
  createdAt?: IsoDate;
  inspectionId?: Identifier | null;
  observationId?: Identifier | null;
  activityId?: Identifier | null;
  violationId?: Identifier | null;
}

export interface Inspection {
  id: Identifier;
  reference: string;
  type: InspectionType;
  status: InspectionStatus;
  outcome?: InspectionOutcome | null;
  complianceScore?: number | null;
  title: string;
  summary?: string | null;
  recommendations?: string | null;
  forestId: Identifier;
  zoneId?: Identifier | null;
  protectedAreaId?: Identifier | null;
  companyId?: Identifier | null;
  permitId?: Identifier | null;
  activityId?: Identifier | null;
  inspectorId?: Identifier;
  scheduledFor?: IsoDate | null;
  startedAt?: IsoDate | null;
  completedAt?: IsoDate | null;
  submittedAt?: IsoDate | null;
  reviewedAt?: IsoDate | null;
  latitude?: Numeric | null;
  longitude?: Numeric | null;
  locationAccuracyM?: Numeric | null;
  gpsCapturedAt?: IsoDate | null;
  gpsSource?: GpsSource;
  distanceFromTargetM?: Numeric | null;
  verifiedHarvestedVolumeM3?: Numeric | null;
  verifiedTreeCount?: number | null;
  discrepancies?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  forest?: Pick<Forest, 'id' | 'code' | 'name' | 'region'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  protectedArea?: Pick<ProtectedArea, 'id' | 'code' | 'name'> | null;
  company?: CompanySummary | null;
  permit?: Pick<Permit, 'id' | 'permitNumber' | 'status'> | null;
  activity?: Pick<ExploitationActivity, 'id' | 'reference' | 'activityType' | 'status'> | null;
  inspector?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  reviewedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  checklist?: ChecklistItem[];
  evidences?: Evidence[];
  _count?: { evidences?: number; observations?: number; violations?: number };
}

// ----------------------------------------------------------------- observations

export type ObservationCategory =
  | 'TREE_CONDITION'
  | 'WILDLIFE'
  | 'VEGETATION_COVER'
  | 'SOIL'
  | 'WATER_BODY'
  | 'ENCROACHMENT'
  | 'ILLEGAL_LOGGING'
  | 'INFRASTRUCTURE'
  | 'FIRE_DAMAGE'
  | 'WEATHER'
  | 'INCIDENT'
  | 'OTHER';

export type ViolationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FieldObservation {
  id: Identifier;
  forestId: Identifier;
  zoneId?: Identifier | null;
  protectedAreaId?: Identifier | null;
  activityId?: Identifier | null;
  inspectionId?: Identifier | null;
  category: ObservationCategory;
  severity?: ViolationSeverity | null;
  title: string;
  description: string;
  latitude: Numeric;
  longitude: Numeric;
  locationAccuracyM?: Numeric | null;
  capturedAt: IsoDate;
  gpsSource?: GpsSource;
  observedById?: Identifier;
  isDemo?: boolean;
  aiProcessedAt?: IsoDate | null;
  syncStatus?: SyncStatus;
  clientRef?: string | null;
  createdAt?: IsoDate;
  forest?: Pick<Forest, 'id' | 'code' | 'name'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  protectedArea?: Pick<ProtectedArea, 'id' | 'code' | 'name'> | null;
  observedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  evidences?: Evidence[];
}

// ------------------------------------------------------------------ violations

export type ViolationStatus = 'OPEN' | 'UNDER_INVESTIGATION' | 'CONFIRMED' | 'RESOLVED' | 'DISMISSED' | 'ESCALATED';

export interface ViolationPenalty {
  penaltyAmountXAF: number;
  paidXAF: number;
  outstandingXAF: number;
  settled: boolean;
}

export interface Violation {
  id: Identifier;
  reference: string;
  title: string;
  description: string;
  severity: ViolationSeverity;
  status: ViolationStatus;
  forestId: Identifier;
  zoneId?: Identifier | null;
  protectedAreaId?: Identifier | null;
  companyId?: Identifier | null;
  permitId?: Identifier | null;
  activityId?: Identifier | null;
  inspectionId?: Identifier | null;
  observationId?: Identifier | null;
  aiAlertId?: Identifier | null;
  latitude: Numeric;
  longitude: Numeric;
  detectedAt: IsoDate;
  detectedById?: Identifier;
  estimatedDamageXAF?: Numeric | null;
  penaltyAmountXAF?: Numeric | null;
  remediationRequired?: boolean;
  remediationDeadline?: IsoDate | null;
  remediationNotes?: string | null;
  investigationNotes?: string | null;
  resolvedAt?: IsoDate | null;
  resolutionSummary?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  forest?: Pick<Forest, 'id' | 'code' | 'name' | 'region'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  protectedArea?: Pick<ProtectedArea, 'id' | 'code' | 'name'> | null;
  company?: CompanySummary | null;
  permit?: Pick<Permit, 'id' | 'permitNumber' | 'status'> | null;
  activity?: Pick<ExploitationActivity, 'id' | 'reference' | 'activityType' | 'status'> | null;
  inspection?: Pick<Inspection, 'id' | 'reference' | 'status' | 'outcome'> | null;
  detectedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  evidences?: Evidence[];
  payments?: Payment[];
  penalty?: ViolationPenalty;
  remediationOverdue?: boolean;
}

// -------------------------------------------------------------------------- AI

export type AlertType =
  | 'DEFORESTATION_RISK'
  | 'OVER_HARVESTING'
  | 'PERMIT_VIOLATION'
  | 'UNAUTHORIZED_ACTIVITY'
  | 'ENVIRONMENTAL_HAZARD'
  | 'PROTECTED_AREA_ENCROACHMENT'
  | 'OPERATIONAL_ANOMALY'
  | 'DOCUMENT_ANOMALY'
  | 'PAYMENT_ANOMALY'
  | 'FIELD_REPORT_ANOMALY';
export type AlertStatus = 'NEW' | 'REVIEWING' | 'CONFIRMED' | 'DISMISSED' | 'RESOLVED';
export type AlertAction = 'ACKNOWLEDGE' | 'CONFIRM' | 'DISMISS' | 'RESOLVE' | 'REOPEN';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type AiAnalysisType =
  | 'RISK_ASSESSMENT'
  | 'ANOMALY_DETECTION'
  | 'OBSERVATION_ANALYSIS'
  | 'INSPECTION_SUMMARY'
  | 'COMPLIANCE_SUMMARY'
  | 'PERMIT_REVIEW_ASSIST'
  | 'EXPLOITATION_PATTERN';
export type AiAnalysisStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type AiProvider = 'GEMINI' | 'LOCAL_RULE_ENGINE';

export interface AiAlert {
  id: Identifier;
  reference: string;
  type: AlertType;
  status: AlertStatus;
  riskLevel: RiskLevel;
  confidence?: Numeric | null;
  title: string;
  description: string;
  reasoning?: string | null;
  detector: AiProvider;
  analysisId?: Identifier | null;
  entityType?: string | null;
  entityId?: Identifier | null;
  forestId?: Identifier | null;
  zoneId?: Identifier | null;
  protectedAreaId?: Identifier | null;
  companyId?: Identifier | null;
  permitId?: Identifier | null;
  activityId?: Identifier | null;
  inspectionId?: Identifier | null;
  observationId?: Identifier | null;
  latitude?: Numeric | null;
  longitude?: Numeric | null;
  detectedAt: IsoDate;
  reviewedById?: Identifier | null;
  reviewedAt?: IsoDate | null;
  reviewNotes?: string | null;
  resolutionAction?: string | null;
  resolvedAt?: IsoDate | null;
  violationId?: Identifier | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  analysis?: { id: Identifier; type: AiAnalysisType; status: AiAnalysisStatus; provider: AiProvider; summary?: string | null };
  forest?: Pick<Forest, 'id' | 'code' | 'name' | 'region'> | null;
  zone?: Pick<ForestZone, 'id' | 'code' | 'name'> | null;
  protectedArea?: Pick<ProtectedArea, 'id' | 'code' | 'name'> | null;
  company?: CompanySummary | null;
  permit?: Pick<Permit, 'id' | 'permitNumber' | 'status'> | null;
  activity?: Pick<ExploitationActivity, 'id' | 'reference' | 'activityType' | 'status'> | null;
  inspection?: Pick<Inspection, 'id' | 'reference' | 'status'> | null;
  reviewedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  review?: { requiresHumanDecision: boolean; overdue: boolean; isClosed: boolean; detectorLabel: string; riskScore: number };
  actions?: AlertAction[];
}

export interface AiAnalysis {
  id: Identifier;
  type: AiAnalysisType;
  status: AiAnalysisStatus;
  provider: AiProvider;
  model?: string | null;
  promptText?: string | null;
  resultJson?: string | null;
  summary?: string | null;
  riskLevel?: RiskLevel | null;
  confidence?: Numeric | null;
  entityType?: string | null;
  entityId?: Identifier | null;
  forestId?: Identifier | null;
  latencyMs?: number | null;
  tokensUsed?: number | null;
  errorMessage?: string | null;
  requestedById?: Identifier;
  startedAt?: IsoDate;
  completedAt?: IsoDate | null;
  createdAt?: IsoDate;
  requestedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName'> | null;
  _count?: { alerts?: number };
}

export interface AiRule {
  code: string;
  label: string;
  alertType: AlertType;
  description?: string;
}

export interface AiStatus {
  provider: AiProvider;
  geminiConfigured: boolean;
  model: string;
  deterministicEngine: {
    version: string;
    rules: AiRule[];
    thresholds: Record<string, number>;
    description: string;
  };
  capabilities: {
    canRunAnalysis: boolean;
    canReviewAlerts: boolean;
    canReadAlerts: boolean;
    canUseAssistant: boolean;
    maxQuestionLength: number;
    alertReviewSlaHours: number;
  };
  counters: { alerts: number; alertsAwaitingReview: number; conversations: number };
  message: string;
  guardrails: string[];
  lastAnalysis?: AiAnalysis | null;
}

export interface AiCatalogue {
  provider: { provider: AiProvider; configured: boolean; model: string; baseUrl?: string; message: string };
  detectorVersion: string;
  rules: AiRule[];
  thresholds: Record<string, number>;
  analysisTypes: AiAnalysisType[];
  alertStatuses: AlertStatus[];
  riskLevels: RiskLevel[];
  assistantSections: { key: string; label: string; permission: string; description: string }[];
  alertActions: { action: AlertAction; permissions: string[]; reasonRequired: boolean }[];
  reasonMinLength: number;
}

export interface AiMessage {
  id: Identifier;
  conversationId?: Identifier;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  provider?: AiProvider | null;
  model?: string | null;
  latencyMs?: number | null;
  createdAt: IsoDate;
  citations?: string[] | null;
}

export interface AiConversation {
  id: Identifier;
  title: string;
  archivedAt?: IsoDate | null;
  createdAt: IsoDate;
  updatedAt?: IsoDate;
  messages?: AiMessage[];
  _count?: { messages?: number };
}

export interface AssistantAnswer {
  conversation: AiConversation;
  message: AiMessage;
  provider: AiProvider;
  model?: string | null;
  usedRulesFallback?: boolean;
  notice?: string | null;
}

// --------------------------------------------------------------------- reports

export type ReportType =
  | 'PERMITS'
  | 'EXPLOITATION_ACTIVITIES'
  | 'PAYMENTS'
  | 'INSPECTIONS'
  | 'ENVIRONMENTAL_VIOLATIONS'
  | 'FOREST_ACTIVITIES'
  | 'AI_ALERTS'
  | 'COMPLIANCE_SUMMARY';
export type ReportFormat = 'JSON' | 'CSV' | 'PDF';
export type ReportStatus = 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED';

export interface Report {
  id: Identifier;
  reference: string;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  title: string;
  parametersJson?: string | null;
  summaryJson?: string | null;
  dateFrom?: IsoDate | null;
  dateTo?: IsoDate | null;
  forestId?: Identifier | null;
  companyId?: Identifier | null;
  permitId?: Identifier | null;
  fileUrl?: string | null;
  fileKey?: string | null;
  sizeBytes?: number | null;
  generatedById?: Identifier;
  generatedAt?: IsoDate | null;
  errorMessage?: string | null;
  isDemo?: boolean;
  createdAt?: IsoDate;
  generatedBy?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
  forest?: Pick<Forest, 'id' | 'code' | 'name'> | null;
  company?: CompanySummary | null;
  summary?: { label: string; value: string }[];
  notes?: string[];
  rowCount?: number;
  totals?: { amount?: number };
}

export interface ReportCatalogueEntry {
  type: ReportType;
  label: string;
  description: string;
  formats: ReportFormat[];
  columns: { key: string; label: string; type?: string }[];
}

export interface ReportCatalogue {
  reportTypes: ReportCatalogueEntry[];
  formats: ReportFormat[];
  maxRows: number;
}

// --------------------------------------------------------------- notifications

export type NotificationType =
  | 'PERMIT_SUBMITTED'
  | 'PERMIT_APPROVED'
  | 'PERMIT_REJECTED'
  | 'PERMIT_REVISION_REQUIRED'
  | 'PERMIT_ACTIVATED'
  | 'PERMIT_SUSPENDED'
  | 'PERMIT_REVOKED'
  | 'PERMIT_EXPIRING'
  | 'PERMIT_EXPIRED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_SUCCESSFUL'
  | 'PAYMENT_FAILED'
  | 'INSPECTION_ASSIGNED'
  | 'INSPECTION_COMPLETED'
  | 'INSPECTION_SUBMITTED'
  | 'VIOLATION_RECORDED'
  | 'VIOLATION_RESOLVED'
  | 'AI_ALERT_GENERATED'
  | 'AI_ALERT_ASSIGNED'
  | 'AI_ALERT_RESOLVED'
  | 'ACTIVITY_SCHEDULED'
  | 'ACTIVITY_SUBMITTED'
  | 'OBSERVATION_RECORDED'
  | 'REPORT_READY'
  | 'COMPANY_VERIFIED'
  | 'ACCOUNT_ACTIVATED'
  | 'SYSTEM_ANNOUNCEMENT';

export interface AppNotification {
  id: Identifier;
  userId: Identifier;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: Identifier | null;
  actionUrl?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  readAt?: IsoDate | null;
  deliveredInApp?: boolean;
  deliveredPush?: boolean;
  deliveredEmail?: boolean;
  createdAt: IsoDate;
  expiresAt?: IsoDate | null;
}

// ------------------------------------------------------------------------- GIS

export type GisFeatureType =
  | 'FOREST'
  | 'FOREST_ZONE'
  | 'PROTECTED_AREA'
  | 'EXPLOITATION_ACTIVITY'
  | 'INSPECTION'
  | 'FIELD_OBSERVATION'
  | 'AI_ALERT'
  | 'ENVIRONMENTAL_VIOLATION'
  | 'COMPANY_SITE'
  | 'USER_CHECKIN';

export interface GisFeature {
  type: 'Feature';
  id: Identifier;
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: string; coordinates: unknown };
  properties: {
    featureType: GisFeatureType;
    label: string;
    description?: string | null;
    severity?: string | null;
    status?: string | null;
    latitude?: number;
    longitude?: number;
    updatedAt?: string | null;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface GisMapPayload {
  type: 'FeatureCollection';
  features: GisFeature[];
  meta: { count: number; limit: number };
}

export interface GisLayerInfo {
  layers: { featureType: GisFeatureType; count: number }[];
  total: number;
}

export interface GisStatistics {
  featureCounts: { featureType: GisFeatureType; count: number }[];
  forests: number;
  zones: number;
  forestsWithoutBoundary: number;
  fieldCheckins: number;
}

export interface GisPosition {
  id: Identifier;
  userId?: Identifier;
  latitude: Numeric;
  longitude: Numeric;
  accuracyM?: Numeric | null;
  elevationM?: Numeric | null;
  source?: GpsSource;
  label?: string | null;
  capturedAt?: IsoDate;
  createdAt?: IsoDate;
  mocked?: boolean;
}

export interface NearbyResult {
  feature: GisFeature;
  distanceKm: number;
}

// ----------------------------------------------------------------------- audit

export interface AuditEntry {
  id: Identifier;
  actorId?: Identifier | null;
  actorEmail?: string | null;
  action: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  entityType?: string | null;
  entityId?: Identifier | null;
  description: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: IsoDate;
  actor?: Pick<DirectoryUser, 'id' | 'firstName' | 'lastName' | 'email'> | null;
}

// ---------------------------------------------------------------------- stats

export interface PermitStatistics {
  total: number;
  totalVolumeRequestedM3: number;
  totalVolumeApprovedM3: number;
  totalFeeAmount: number;
  byStatus: { status: PermitStatus; count: number }[];
  byType: { type: PermitType; count: number }[];
  expiringSoon: Pick<Permit, 'id' | 'permitNumber' | 'title' | 'endDate' | 'company' | 'forest'>[];
}

export interface ActivityStatistics {
  total: number;
  plannedVolumeM3: number;
  harvestedVolumeM3: number;
  utilisationRate?: number;
  byStatus?: { status: ActivityStatus; count: number }[];
  byType?: { type: ActivityType; count: number }[];
  monthly?: { month: string; volumeM3: number; activities: number }[];
  topCompanies?: { companyId: Identifier; companyName: string; volumeM3: number }[];
  byForest?: { forestId: Identifier; forestName: string; volumeM3: number }[];
}

export interface InspectionStatistics {
  total: number;
  averageComplianceScore: number;
  byStatus: { status: InspectionStatus; count: number }[];
  byType: { type: InspectionType; count: number }[];
  byOutcome: { outcome: InspectionOutcome; count: number }[];
  openViolationsBySeverity: { severity: ViolationSeverity; count: number }[];
}

export interface ViolationStatistics {
  total: number;
  estimatedDamageXAF: number;
  lastDetectedAt?: IsoDate | null;
  openCases: number;
  overdueRemediation: number;
  penalties: ViolationPenalty;
  byStatus: { status: ViolationStatus; count: number }[];
  bySeverity: { severity: ViolationSeverity; count: number }[];
  byForest: { forestId: Identifier | null; forestName: string | null; forestCode: string | null; count: number }[];
  monthly: { month: string; count: number }[];
}

export interface AlertStatistics {
  total: number;
  awaitingReview: number;
  overdueReview: number;
  confirmed: number;
  dismissed: number;
  resolved: number;
  byStatus: { status: AlertStatus; count: number }[];
  byRisk: { riskLevel: RiskLevel; count: number }[];
  byType: { type: AlertType; count: number }[];
  reviewSlaHours: number;
  detectorVersion: string;
  provider: AiProvider;
  humanReview: {
    reviewed: number;
    awaitingFirstReview: number;
    overdue: number;
    confirmedByOfficer: number;
    dismissedByOfficer: number;
    confirmationRate: number;
  };
  byDetector: { detector: AiProvider; count: number }[];
  note: string;
}

export interface PaymentStatistics {
  total: number;
  totalAmount: number;
  successfulAmount?: number;
  outstandingAmount?: number;
  byStatus: { status: PaymentStatus; count: number }[];
  byPurpose: { purpose: PaymentPurpose; count: number; amount?: number }[];
  monthly?: { month: string; amount: number; count: number }[];
}

export interface ReportStatistics {
  total: number;
  byType: { type: ReportType; count: number }[];
  byStatus: { status: ReportStatus; count: number }[];
  recent?: Report[];
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  checks: { database: 'up' | 'down'; databaseLatencyMs: number; databaseError?: string };
  timestamp: IsoDate;
}

export type DashboardStatistics = Record<string, never>;
