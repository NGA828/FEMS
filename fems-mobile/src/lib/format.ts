/**
 * Formatting and enum labels.
 *
 * Enum labels come from the same vocabulary as the backend (`schema.prisma`), so
 * a status shown in the app reads the same as the one in the database, the API
 * response and the generated reports. Every label is provided in English and
 * French — the API's `preferredLanguage` on the account selects the display.
 */
import type {
  ActivityStatus,
  ActivityType,
  AlertStatus,
  AlertType,
  ChecklistResult,
  CompanyStatus,
  CompanyType,
  DocumentType,
  EquipmentCategory,
  EquipmentStatus,
  ForestStatus,
  ForestType,
  GisFeatureType,
  InspectionOutcome,
  InspectionStatus,
  InspectionType,
  NotificationType,
  ObservationCategory,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  PermitStatus,
  PermitType,
  ProtectedAreaType,
  ReportFormat,
  ReportStatus,
  ReportType,
  RiskLevel,
  UserStatus,
  ViolationSeverity,
  ViolationStatus,
  ZoneType,
} from '../api/types';

export type Language = 'en' | 'fr';

type Bilingual = { en: string; fr: string };

function label(map: Record<string, Bilingual> | undefined, key: string | null | undefined, language: Language): string {
  if (!key) return '—';
  const entry = map?.[key];
  if (!entry) {
    return key
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return entry[language];
}

export const LABELS = {
  permitStatus: {
    DRAFT: { en: 'Draft', fr: 'Brouillon' },
    SUBMITTED: { en: 'Submitted', fr: 'Soumis' },
    UNDER_REVIEW: { en: 'Under review', fr: 'En examen' },
    REVISION_REQUIRED: { en: 'Revision required', fr: 'Révision requise' },
    REJECTED: { en: 'Rejected', fr: 'Rejeté' },
    APPROVED: { en: 'Approved', fr: 'Approuvé' },
    PAYMENT_PENDING: { en: 'Payment pending', fr: 'Paiement en attente' },
    ACTIVE: { en: 'Active', fr: 'Actif' },
    SUSPENDED: { en: 'Suspended', fr: 'Suspendu' },
    EXPIRED: { en: 'Expired', fr: 'Expiré' },
    REVOKED: { en: 'Revoked', fr: 'Révoqué' },
    CANCELLED: { en: 'Cancelled', fr: 'Annulé' },
  } satisfies Record<PermitStatus, Bilingual>,
  permitType: {
    EXPLOITATION: { en: 'Exploitation', fr: 'Exploitation' },
    TRANSPORT: { en: 'Transport', fr: 'Transport' },
    PROCESSING: { en: 'Processing', fr: 'Transformation' },
    EXPORT: { en: 'Export', fr: 'Exportation' },
    ARTISANAL: { en: 'Artisanal', fr: 'Artisanal' },
    RECONNAISSANCE: { en: 'Reconnaissance', fr: 'Reconnaissance' },
    COMMUNITY_FOREST: { en: 'Community forest', fr: 'Forêt communautaire' },
  } satisfies Record<PermitType, Bilingual>,
  activityStatus: {
    PLANNED: { en: 'Planned', fr: 'Planifiée' },
    SCHEDULED: { en: 'Scheduled', fr: 'Programmée' },
    IN_PROGRESS: { en: 'In progress', fr: 'En cours' },
    COMPLETED: { en: 'Completed', fr: 'Terminée' },
    SUSPENDED: { en: 'Suspended', fr: 'Suspendue' },
    CANCELLED: { en: 'Cancelled', fr: 'Annulée' },
  } satisfies Record<ActivityStatus, Bilingual>,
  activityType: {
    TIMBER_HARVEST: { en: 'Timber harvest', fr: 'Abattage' },
    LOG_TRANSPORT: { en: 'Log transport', fr: 'Transport de grumes' },
    SITE_CLEARING: { en: 'Site clearing', fr: 'Débroussaillage' },
    PLANTING: { en: 'Planting', fr: 'Plantation' },
    FOREST_SURVEY: { en: 'Forest survey', fr: 'Inventaire forestier' },
    ROAD_CONSTRUCTION: { en: 'Road construction', fr: 'Ouverture de piste' },
    MAINTENANCE: { en: 'Maintenance', fr: 'Entretien' },
    SALVAGE_LOGGING: { en: 'Salvage logging', fr: 'Récupération' },
  } satisfies Record<ActivityType, Bilingual>,
  paymentStatus: {
    PENDING: { en: 'Pending', fr: 'En attente' },
    PROCESSING: { en: 'Processing', fr: 'En traitement' },
    SUCCESSFUL: { en: 'Successful', fr: 'Réussi' },
    FAILED: { en: 'Failed', fr: 'Échoué' },
    CANCELLED: { en: 'Cancelled', fr: 'Annulé' },
    REFUNDED: { en: 'Refunded', fr: 'Remboursé' },
  } satisfies Record<PaymentStatus, Bilingual>,
  paymentPurpose: {
    PERMIT_FEE: { en: 'Permit fee', fr: 'Frais de permis' },
    ROYALTY: { en: 'Royalty', fr: 'Redevance' },
    ANNUAL_TAX: { en: 'Annual tax', fr: 'Taxe annuelle' },
    PENALTY: { en: 'Penalty', fr: 'Amende' },
    REPLANTING_BOND: { en: 'Replanting bond', fr: 'Caution de reboisement' },
    OTHER: { en: 'Other', fr: 'Autre' },
  } satisfies Record<PaymentPurpose, Bilingual>,
  paymentMethod: {
    MOBILE_MONEY_MTN: { en: 'MTN Mobile Money', fr: 'MTN Mobile Money' },
    MOBILE_MONEY_ORANGE: { en: 'Orange Money', fr: 'Orange Money' },
    MOBILE_MONEY_AIRTEL: { en: 'Airtel Money', fr: 'Airtel Money' },
    CARD: { en: 'Bank card', fr: 'Carte bancaire' },
    BANK_TRANSFER: { en: 'Bank transfer', fr: 'Virement bancaire' },
    CASH: { en: 'Cash', fr: 'Espèces' },
  } satisfies Record<PaymentMethod, Bilingual>,
  inspectionStatus: {
    SCHEDULED: { en: 'Scheduled', fr: 'Programmée' },
    IN_PROGRESS: { en: 'In progress', fr: 'En cours' },
    SUBMITTED: { en: 'Submitted', fr: 'Soumise' },
    REVIEWED: { en: 'Reviewed', fr: 'Révisée' },
    CLOSED: { en: 'Closed', fr: 'Clôturée' },
    CANCELLED: { en: 'Cancelled', fr: 'Annulée' },
  } satisfies Record<InspectionStatus, Bilingual>,
  inspectionType: {
    ROUTINE: { en: 'Routine', fr: 'Routine' },
    COMPLIANCE: { en: 'Compliance', fr: 'Conformité' },
    ENVIRONMENTAL: { en: 'Environmental', fr: 'Environnementale' },
    POST_ACTIVITY: { en: 'Post-activity', fr: 'Après activité' },
    INCIDENT: { en: 'Incident', fr: 'Incident' },
    VERIFICATION: { en: 'Verification', fr: 'Vérification' },
  } satisfies Record<InspectionType, Bilingual>,
  inspectionOutcome: {
    COMPLIANT: { en: 'Compliant', fr: 'Conforme' },
    MINOR_NON_COMPLIANCE: { en: 'Minor non-compliance', fr: 'Non-conformité mineure' },
    MAJOR_NON_COMPLIANCE: { en: 'Major non-compliance', fr: 'Non-conformité majeure' },
    CRITICAL_NON_COMPLIANCE: { en: 'Critical non-compliance', fr: 'Non-conformité critique' },
  } satisfies Record<InspectionOutcome, Bilingual>,
  checklistResult: {
    PASS: { en: 'Pass', fr: 'Conforme' },
    FAIL: { en: 'Fail', fr: 'Non conforme' },
    NOT_APPLICABLE: { en: 'Not applicable', fr: 'Non applicable' },
  } satisfies Record<ChecklistResult, Bilingual>,
  violationStatus: {
    OPEN: { en: 'Open', fr: 'Ouvert' },
    UNDER_INVESTIGATION: { en: 'Under investigation', fr: 'En enquête' },
    CONFIRMED: { en: 'Confirmed', fr: 'Confirmé' },
    RESOLVED: { en: 'Resolved', fr: 'Résolu' },
    DISMISSED: { en: 'Dismissed', fr: 'Classé' },
    ESCALATED: { en: 'Escalated', fr: 'Escaladé' },
  } satisfies Record<ViolationStatus, Bilingual>,
  severity: {
    LOW: { en: 'Low', fr: 'Faible' },
    MEDIUM: { en: 'Medium', fr: 'Moyenne' },
    HIGH: { en: 'High', fr: 'Élevée' },
    CRITICAL: { en: 'Critical', fr: 'Critique' },
  } satisfies Record<ViolationSeverity, Bilingual>,
  riskLevel: {
    LOW: { en: 'Low', fr: 'Faible' },
    MODERATE: { en: 'Moderate', fr: 'Modéré' },
    HIGH: { en: 'High', fr: 'Élevé' },
    CRITICAL: { en: 'Critical', fr: 'Critique' },
  } satisfies Record<RiskLevel, Bilingual>,
  alertStatus: {
    NEW: { en: 'New', fr: 'Nouvelle' },
    REVIEWING: { en: 'Reviewing', fr: 'En examen' },
    CONFIRMED: { en: 'Confirmed', fr: 'Confirmée' },
    DISMISSED: { en: 'Dismissed', fr: 'Écartée' },
    RESOLVED: { en: 'Resolved', fr: 'Résolue' },
  } satisfies Record<AlertStatus, Bilingual>,
  alertType: {
    DEFORESTATION_RISK: { en: 'Deforestation risk', fr: 'Risque de déforestation' },
    OVER_HARVESTING: { en: 'Over-harvesting', fr: 'Surexploitation' },
    PERMIT_VIOLATION: { en: 'Permit violation', fr: 'Violation de permis' },
    UNAUTHORIZED_ACTIVITY: { en: 'Unauthorised activity', fr: 'Activité non autorisée' },
    ENVIRONMENTAL_HAZARD: { en: 'Environmental hazard', fr: 'Risque environnemental' },
    PROTECTED_AREA_ENCROACHMENT: { en: 'Protected-area encroachment', fr: 'Empiètement aire protégée' },
    OPERATIONAL_ANOMALY: { en: 'Operational anomaly', fr: 'Anomalie opérationnelle' },
    DOCUMENT_ANOMALY: { en: 'Document anomaly', fr: 'Anomalie documentaire' },
    PAYMENT_ANOMALY: { en: 'Payment anomaly', fr: 'Anomalie de paiement' },
    FIELD_REPORT_ANOMALY: { en: 'Field report anomaly', fr: 'Anomalie de rapport terrain' },
  } satisfies Record<AlertType, Bilingual>,
  forestStatus: {
    ACTIVE: { en: 'Active', fr: 'Active' },
    UNDER_MANAGEMENT: { en: 'Under management', fr: 'Sous aménagement' },
    DEGRADED: { en: 'Degraded', fr: 'Dégradée' },
    PROTECTED: { en: 'Protected', fr: 'Protégée' },
    CLOSED: { en: 'Closed', fr: 'Fermée' },
  } satisfies Record<ForestStatus, Bilingual>,
  forestType: {
    PRODUCTION: { en: 'Production', fr: 'Production' },
    PROTECTION: { en: 'Protection', fr: 'Protection' },
    COMMUNITY: { en: 'Community', fr: 'Communautaire' },
    REGENERATION: { en: 'Regeneration', fr: 'Régénération' },
    PLANTATION: { en: 'Plantation', fr: 'Plantation' },
    MIXED: { en: 'Mixed', fr: 'Mixte' },
  } satisfies Record<ForestType, Bilingual>,
  zoneType: {
    PRODUCTION: { en: 'Production', fr: 'Production' },
    PROTECTION: { en: 'Protection', fr: 'Protection' },
    CONSERVATION: { en: 'Conservation', fr: 'Conservation' },
    COMMUNITY: { en: 'Community', fr: 'Communautaire' },
    REGENERATION: { en: 'Regeneration', fr: 'Régénération' },
    BUFFER: { en: 'Buffer', fr: 'Zone tampon' },
    SACRED: { en: 'Sacred', fr: 'Sacrée' },
  } satisfies Record<ZoneType, Bilingual>,
  protectedAreaType: {
    NATIONAL_PARK: { en: 'National park', fr: 'Parc national' },
    WILDLIFE_RESERVE: { en: 'Wildlife reserve', fr: 'Réserve de faune' },
    FOREST_RESERVE: { en: 'Forest reserve', fr: 'Réserve forestière' },
    COMMUNITY_FOREST: { en: 'Community forest', fr: 'Forêt communautaire' },
    BIOSPHERE_RESERVE: { en: 'Biosphere reserve', fr: 'Réserve de biosphère' },
    SANCTUARY: { en: 'Sanctuary', fr: 'Sanctuaire' },
    RAMSAR_SITE: { en: 'Ramsar site', fr: 'Site Ramsar' },
  } satisfies Record<ProtectedAreaType, Bilingual>,
  companyStatus: {
    PENDING: { en: 'Pending', fr: 'En attente' },
    VERIFIED: { en: 'Verified', fr: 'Vérifiée' },
    SUSPENDED: { en: 'Suspended', fr: 'Suspendue' },
    REJECTED: { en: 'Rejected', fr: 'Rejetée' },
  } satisfies Record<CompanyStatus, Bilingual>,
  companyType: {
    LOGGING_COMPANY: { en: 'Logging company', fr: 'Société forestière' },
    TIMBER_TRADER: { en: 'Timber trader', fr: 'Négociant de bois' },
    SAWMILL: { en: 'Sawmill', fr: 'Scierie' },
    ARTISANAL: { en: 'Artisanal', fr: 'Artisanal' },
    COOPERATIVE: { en: 'Cooperative', fr: 'Coopérative' },
    WOOD_PROCESSING: { en: 'Wood processing', fr: 'Transformation du bois' },
    OTHER: { en: 'Other', fr: 'Autre' },
  } satisfies Record<CompanyType, Bilingual>,
  userStatus: {
    PENDING_VERIFICATION: { en: 'Pending verification', fr: 'Vérification en attente' },
    ACTIVE: { en: 'Active', fr: 'Actif' },
    SUSPENDED: { en: 'Suspended', fr: 'Suspendu' },
    DEACTIVATED: { en: 'Deactivated', fr: 'Désactivé' },
  } satisfies Record<UserStatus, Bilingual>,
  equipmentCategory: {
    HARVESTER: { en: 'Harvester', fr: 'Abatteuse' },
    CHAINSAW: { en: 'Chainsaw', fr: 'Tronçonneuse' },
    LOGGING_TRUCK: { en: 'Logging truck', fr: 'Camion grumier' },
    TRACTOR: { en: 'Tractor', fr: 'Tracteur' },
    SKIDDER: { en: 'Skidder', fr: 'Débusqueuse' },
    LOG_LOADER: { en: 'Log loader', fr: 'Chargeuse' },
    BULLDOZER: { en: 'Bulldozer', fr: 'Bulldozer' },
    DRONE: { en: 'Drone', fr: 'Drone' },
    SURVEY_EQUIPMENT: { en: 'Survey equipment', fr: 'Matériel de levé' },
    OTHER: { en: 'Other', fr: 'Autre' },
  } satisfies Record<EquipmentCategory, Bilingual>,
  equipmentStatus: {
    AVAILABLE: { en: 'Available', fr: 'Disponible' },
    IN_USE: { en: 'In use', fr: 'En service' },
    MAINTENANCE: { en: 'Maintenance', fr: 'Maintenance' },
    OUT_OF_SERVICE: { en: 'Out of service', fr: 'Hors service' },
  } satisfies Record<EquipmentStatus, Bilingual>,
  observationCategory: {
    TREE_CONDITION: { en: 'Tree condition', fr: 'État des arbres' },
    WILDLIFE: { en: 'Wildlife', fr: 'Faune' },
    VEGETATION_COVER: { en: 'Vegetation cover', fr: 'Couvert végétal' },
    SOIL: { en: 'Soil', fr: 'Sol' },
    WATER_BODY: { en: 'Water body', fr: 'Cours d’eau' },
    ENCROACHMENT: { en: 'Encroachment', fr: 'Empiètement' },
    ILLEGAL_LOGGING: { en: 'Illegal logging', fr: 'Coupe illégale' },
    INFRASTRUCTURE: { en: 'Infrastructure', fr: 'Infrastructure' },
    FIRE_DAMAGE: { en: 'Fire damage', fr: 'Dégâts de feu' },
    WEATHER: { en: 'Weather', fr: 'Météo' },
    INCIDENT: { en: 'Incident', fr: 'Incident' },
    OTHER: { en: 'Other', fr: 'Autre' },
  } satisfies Record<ObservationCategory, Bilingual>,
  documentType: {
    COMPANY_REGISTRATION: { en: 'Company registration', fr: 'Registre de commerce' },
    TAX_CLEARANCE: { en: 'Tax clearance', fr: 'Attestation fiscale' },
    ENVIRONMENTAL_IMPACT_ASSESSMENT: { en: 'Environmental impact assessment', fr: 'Étude d’impact environnemental' },
    MANAGEMENT_PLAN: { en: 'Management plan', fr: 'Plan d’aménagement' },
    LAND_TITLE: { en: 'Land title', fr: 'Titre foncier' },
    IDENTITY_DOCUMENT: { en: 'Identity document', fr: 'Pièce d’identité' },
    EXPLOITATION_LICENCE: { en: 'Exploitation licence', fr: 'Licence d’exploitation' },
    TRANSPORT_PERMIT: { en: 'Transport permit', fr: 'Permis de transport' },
    OTHER: { en: 'Other', fr: 'Autre' },
  } satisfies Record<DocumentType, Bilingual>,
  reportType: {
    PERMITS: { en: 'Permits', fr: 'Permis' },
    EXPLOITATION_ACTIVITIES: { en: 'Exploitation activities', fr: 'Activités d’exploitation' },
    PAYMENTS: { en: 'Payments', fr: 'Paiements' },
    INSPECTIONS: { en: 'Inspections', fr: 'Inspections' },
    ENVIRONMENTAL_VIOLATIONS: { en: 'Environmental cases', fr: 'Contentieux environnementaux' },
    FOREST_ACTIVITIES: { en: 'Forest activities', fr: 'Activités forestières' },
    AI_ALERTS: { en: 'AI alerts', fr: 'Alertes IA' },
    COMPLIANCE_SUMMARY: { en: 'Compliance summary', fr: 'Synthèse de conformité' },
  } satisfies Record<ReportType, Bilingual>,
  reportFormat: {
    JSON: { en: 'JSON', fr: 'JSON' },
    CSV: { en: 'CSV', fr: 'CSV' },
    PDF: { en: 'PDF', fr: 'PDF' },
  } satisfies Record<ReportFormat, Bilingual>,
  reportStatus: {
    DRAFT: { en: 'Draft', fr: 'Brouillon' },
    GENERATING: { en: 'Generating', fr: 'En génération' },
    READY: { en: 'Ready', fr: 'Prêt' },
    FAILED: { en: 'Failed', fr: 'Échec' },
  } satisfies Record<ReportStatus, Bilingual>,
  gisFeature: {
    FOREST: { en: 'Forest', fr: 'Forêt' },
    FOREST_ZONE: { en: 'Zone', fr: 'Parcelle' },
    PROTECTED_AREA: { en: 'Protected area', fr: 'Aire protégée' },
    EXPLOITATION_ACTIVITY: { en: 'Activity', fr: 'Activité' },
    INSPECTION: { en: 'Inspection', fr: 'Inspection' },
    FIELD_OBSERVATION: { en: 'Observation', fr: 'Observation' },
    AI_ALERT: { en: 'AI alert', fr: 'Alerte IA' },
    ENVIRONMENTAL_VIOLATION: { en: 'Case', fr: 'Contentieux' },
    COMPANY_SITE: { en: 'Company site', fr: 'Site d’entreprise' },
    USER_CHECKIN: { en: 'Check-in', fr: 'Pointage' },
  } satisfies Record<GisFeatureType, Bilingual>,
  notification: {
    PERMIT_SUBMITTED: { en: 'Permit submitted', fr: 'Permis soumis' },
    PERMIT_APPROVED: { en: 'Permit approved', fr: 'Permis approuvé' },
    PERMIT_REJECTED: { en: 'Permit rejected', fr: 'Permis rejeté' },
    PERMIT_REVISION_REQUIRED: { en: 'Revision required', fr: 'Révision requise' },
    PERMIT_ACTIVATED: { en: 'Permit activated', fr: 'Permis activé' },
    PERMIT_SUSPENDED: { en: 'Permit suspended', fr: 'Permis suspendu' },
    PERMIT_REVOKED: { en: 'Permit revoked', fr: 'Permis révoqué' },
    PERMIT_EXPIRING: { en: 'Permit expiring', fr: 'Permis expirant' },
    PERMIT_EXPIRED: { en: 'Permit expired', fr: 'Permis expiré' },
    PAYMENT_INITIATED: { en: 'Payment initiated', fr: 'Paiement initié' },
    PAYMENT_SUCCESSFUL: { en: 'Payment successful', fr: 'Paiement réussi' },
    PAYMENT_FAILED: { en: 'Payment failed', fr: 'Paiement échoué' },
    INSPECTION_ASSIGNED: { en: 'Inspection assigned', fr: 'Inspection assignée' },
    INSPECTION_COMPLETED: { en: 'Inspection completed', fr: 'Inspection terminée' },
    INSPECTION_SUBMITTED: { en: 'Inspection submitted', fr: 'Inspection soumise' },
    VIOLATION_RECORDED: { en: 'Case recorded', fr: 'Contentieux enregistré' },
    VIOLATION_RESOLVED: { en: 'Case resolved', fr: 'Contentieux résolu' },
    AI_ALERT_GENERATED: { en: 'AI alert raised', fr: 'Alerte IA générée' },
    AI_ALERT_ASSIGNED: { en: 'AI alert assigned', fr: 'Alerte IA assignée' },
    AI_ALERT_RESOLVED: { en: 'AI alert resolved', fr: 'Alerte IA résolue' },
    ACTIVITY_SCHEDULED: { en: 'Activity scheduled', fr: 'Activité programmée' },
    ACTIVITY_SUBMITTED: { en: 'Activity submitted', fr: 'Activité soumise' },
    OBSERVATION_RECORDED: { en: 'Observation recorded', fr: 'Observation enregistrée' },
    REPORT_READY: { en: 'Report ready', fr: 'Rapport prêt' },
    COMPANY_VERIFIED: { en: 'Company verified', fr: 'Entreprise vérifiée' },
    ACCOUNT_ACTIVATED: { en: 'Account activated', fr: 'Compte activé' },
    SYSTEM_ANNOUNCEMENT: { en: 'Announcement', fr: 'Annonce' },
  } satisfies Record<NotificationType, Bilingual>,
};

export function permitStatusLabel(status: PermitStatus, language: Language = 'en'): string {
  return label(LABELS.permitStatus, status, language);
}
export function permitTypeLabel(type: PermitType, language: Language = 'en'): string {
  return label(LABELS.permitType, type, language);
}
export function activityStatusLabel(status: ActivityStatus, language: Language = 'en'): string {
  return label(LABELS.activityStatus, status, language);
}
export function activityTypeLabel(type: ActivityType, language: Language = 'en'): string {
  return label(LABELS.activityType, type, language);
}
export function paymentStatusLabel(status: PaymentStatus, language: Language = 'en'): string {
  return label(LABELS.paymentStatus, status, language);
}
export function paymentPurposeLabel(purpose: PaymentPurpose, language: Language = 'en'): string {
  return label(LABELS.paymentPurpose, purpose, language);
}
export function paymentMethodLabel(method: PaymentMethod, language: Language = 'en'): string {
  return label(LABELS.paymentMethod, method, language);
}
export function inspectionStatusLabel(status: InspectionStatus, language: Language = 'en'): string {
  return label(LABELS.inspectionStatus, status, language);
}
export function inspectionTypeLabel(type: InspectionType, language: Language = 'en'): string {
  return label(LABELS.inspectionType, type, language);
}
export function inspectionOutcomeLabel(outcome: InspectionOutcome | null | undefined, language: Language = 'en'): string {
  return label(LABELS.inspectionOutcome, outcome, language);
}
export function checklistResultLabel(result: ChecklistResult, language: Language = 'en'): string {
  return label(LABELS.checklistResult, result, language);
}
export function violationStatusLabel(status: ViolationStatus, language: Language = 'en'): string {
  return label(LABELS.violationStatus, status, language);
}
export function severityLabel(severity: ViolationSeverity | null | undefined, language: Language = 'en'): string {
  return label(LABELS.severity, severity, language);
}
export function riskLabel(risk: RiskLevel | null | undefined, language: Language = 'en'): string {
  return label(LABELS.riskLevel, risk, language);
}
export function alertStatusLabel(status: AlertStatus, language: Language = 'en'): string {
  return label(LABELS.alertStatus, status, language);
}
export function alertTypeLabel(type: AlertType, language: Language = 'en'): string {
  return label(LABELS.alertType, type, language);
}
export function forestStatusLabel(status: ForestStatus, language: Language = 'en'): string {
  return label(LABELS.forestStatus, status, language);
}
export function forestTypeLabel(type: ForestType, language: Language = 'en'): string {
  return label(LABELS.forestType, type, language);
}
export function zoneTypeLabel(type: ZoneType, language: Language = 'en'): string {
  return label(LABELS.zoneType, type, language);
}
export function protectedAreaTypeLabel(type: ProtectedAreaType, language: Language = 'en'): string {
  return label(LABELS.protectedAreaType, type, language);
}
export function companyStatusLabel(status: CompanyStatus, language: Language = 'en'): string {
  return label(LABELS.companyStatus, status, language);
}
export function companyTypeLabel(type: CompanyType, language: Language = 'en'): string {
  return label(LABELS.companyType, type, language);
}
export function userStatusLabel(status: UserStatus, language: Language = 'en'): string {
  return label(LABELS.userStatus, status, language);
}
export function equipmentCategoryLabel(category: EquipmentCategory, language: Language = 'en'): string {
  return label(LABELS.equipmentCategory, category, language);
}
export function equipmentStatusLabel(status: EquipmentStatus, language: Language = 'en'): string {
  return label(LABELS.equipmentStatus, status, language);
}
export function observationCategoryLabel(category: ObservationCategory, language: Language = 'en'): string {
  return label(LABELS.observationCategory, category, language);
}
export function documentTypeLabel(type: DocumentType, language: Language = 'en'): string {
  return label(LABELS.documentType, type, language);
}
export function reportTypeLabel(type: ReportType, language: Language = 'en'): string {
  return label(LABELS.reportType, type, language);
}
export function reportStatusLabel(status: ReportStatus, language: Language = 'en'): string {
  return label(LABELS.reportStatus, status, language);
}
export function gisFeatureLabel(type: GisFeatureType, language: Language = 'en'): string {
  return label(LABELS.gisFeature, type, language);
}
export function notificationTypeLabel(type: NotificationType, language: Language = 'en'): string {
  return label(LABELS.notification, type, language);
}

export function humanize(key: string | null | undefined): string {
  if (!key) return '—';
  return key
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// --------------------------------------------------------------------- numbers

export function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `1 250 000 FCFA` — XAF has no minor units. */
export function formatCurrency(value: string | number | null | undefined, currency = 'XAF', language: Language = 'en'): string {
  const amount = toNumber(value);
  const formatted = new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount);
  return `${formatted} ${currency === 'XAF' ? 'FCFA' : currency}`;
}

/** Compact currency for tiles: `12,4 M FCFA`. */
export function formatCurrencyCompact(value: string | number | null | undefined, currency = 'XAF', language: Language = 'en'): string {
  const amount = toNumber(value);
  const unit = currency === 'XAF' ? 'FCFA' : currency;
  const locale = language === 'fr' ? 'fr-FR' : 'en-GB';
  if (Math.abs(amount) >= 1_000_000_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount / 1_000_000_000)} Md ${unit}`;
  if (Math.abs(amount) >= 1_000_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount / 1_000_000)} M ${unit}`;
  if (Math.abs(amount) >= 10_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount / 1000)} k ${unit}`;
  return formatCurrency(amount, currency, language);
}

export function formatNumber(value: string | number | null | undefined, language: Language = 'en', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits }).format(toNumber(value));
}

/** `1 250 m³` */
export function formatVolume(value: string | number | null | undefined, language: Language = 'en', digits = 1): string {
  return `${new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits }).format(toNumber(value))} m³`;
}

export function formatArea(value: string | number | null | undefined, language: Language = 'en', digits = 0): string {
  const hectares = toNumber(value);
  if (hectares >= 10_000) {
    return `${new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits }).format(hectares / 1000)} km²`;
  }
  return `${new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits }).format(hectares)} ha`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

// ----------------------------------------------------------------------- dates

export function formatDate(value: string | Date | null | undefined, language: Language = 'en'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, language: Language = 'en'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined, language: Language = 'en'): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600_000],
    ['month', 30 * 24 * 3600_000],
    ['week', 7 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(diffMs) >= size) return formatter.format(Math.round(diffMs / size), unit);
  }
  return formatter.format(Math.round(diffMs / 1000), 'second');
}

/** Whole days remaining until a date (negative when past). */
export function daysUntil(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (24 * 3600_000));
}

export function toIsoDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return toIsoDateInput(date);
}

// ---------------------------------------------------------------------- people

export function initials(...parts: (string | null | undefined)[]): string {
  const letters = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim().charAt(0).toUpperCase());
  return letters.slice(0, 2).join('') || '?';
}

export function fullName(person?: { firstName?: string | null; lastName?: string | null } | null): string {
  if (!person) return '—';
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  return name || '—';
}

export function truncate(text: string | null | undefined, length = 120): string {
  if (!text) return '';
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/** Parses the JSON columns the API returns as strings (`summaryJson`, …). */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
