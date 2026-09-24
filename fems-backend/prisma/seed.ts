/**
 * FEMS demo seed — a complete, clearly-labelled Cameroonian forestry dataset.
 *
 * What it creates: protected areas, forests and their management zones, twelve
 * commercial timber species with sample inventories, six licensed companies,
 * the eight role accounts, permits in every lifecycle state, field activities
 * captured with real coordinates, payments, inspections with checklists,
 * observations, violations, equipment and reports — then it runs the same
 * deterministic rule engine the API uses (`runRules`) so the alert console
 * opens on genuine engine output.
 *
 * Invariants this file respects:
 *  - every row is flagged `isDemo: true` or carries a `DEMO-` reference, so
 *    demonstration data can never be mistaken for a real regulatory record;
 *  - coordinates are true Cameroonian locations (WGS-84, inside the national
 *    bounding box) and field captures use `GpsSource.SEED_DEMO`, never
 *    `DEVICE_GPS`;
 *  - no seeded payment pretends to be a Campay transaction: they all carry the
 *    explicitly named `SIMULATOR` provider and a note saying so;
 *  - alerts are stored as `NEW` machine signals — the seed never fabricates a
 *    human review decision;
 *  - the seed is idempotent: deterministic ids mean re-running it updates the
 *    same demonstration rows instead of duplicating them.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ActivityStatus,
  ActivityType,
  AiAnalysisStatus,
  AiAnalysisType,
  AiProvider,
  AlertStatus,
  CompanyStatus,
  CompanyType,
  DocumentType,
  EquipmentCategory,
  EquipmentStatus,
  EvidenceSource,
  EvidenceType,
  FieldSessionStatus,
  ForestStatus,
  ForestType,
  GpsSource,
  InspectionOutcome,
  InspectionStatus,
  InspectionType,
  ObservationCategory,
  PaymentMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PermitPriority,
  PermitStatus,
  PermitType,
  ProtectedAreaStatus,
  ProtectedAreaType,
  ReportFormat,
  ReportStatus,
  ReportType,
  RiskLevel,
  SyncStatus,
  TreeHealthStatus,
  UserStatus,
  ViolationSeverity,
  ViolationStatus,
  ZoneStatus,
  ZoneType,
} from '@prisma/client';

import { buildIntelligenceDataset } from '../src/ai/ai-dataset';
import { DETECTOR_VERSION, runRules } from '../src/ai/anomaly-analyzer';
import type { PrismaService } from '../src/prisma/prisma.service';
import { defaultChecklist } from '../src/inspections/inspection-state';

// ---------------------------------------------------------------------------
// environment + client
// ---------------------------------------------------------------------------

function loadEnvFileIfNeeded(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFileIfNeeded();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env before seeding.');
}

const parsedUrl = new URL(databaseUrl);
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: parsedUrl.username,
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ''),
    connectionLimit: 4,
  }),
});

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'FemsDemo#2026';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);

const today = new Date();
const DAY = 86_400_000;
/** `daysFromNow(-30)` → thirty days ago. Times are pinned to 08:00 UTC for readability. */
function daysFromNow(days: number, hour = 8): Date {
  const date = new Date(today.getTime() + days * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));

/** Deterministic pseudo-random source so two runs produce identical demo data. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const counts = new Map<string, number>();
function tally(kind: string, amount = 1): void {
  counts.set(kind, (counts.get(kind) ?? 0) + amount);
}

/** Deterministic, human-readable id — FEMS ids are VarChar(36) so `demo-…` fits. */
async function put(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  id: string,
  data: Record<string, unknown>,
): Promise<string> {
  await model.upsert({ where: { id }, create: { id, ...data }, update: data });
  tally(label);
  return id;
}

/**
 * Upsert on a natural key (composite primary keys such as `userId_roleId`).
 * `create` carries the plain foreign-key columns so Prisma uses the unchecked
 * input — no relation connect is needed for a seed.
 */
async function putComposite(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  where: Record<string, unknown>,
  create: Record<string, unknown>,
  update: Record<string, unknown> = create,
): Promise<void> {
  await model.upsert({ where, create, update });
  tally(label);
}

// ---------------------------------------------------------------------------
// reference data — protected areas, forests, zones, species
// ---------------------------------------------------------------------------

interface ProtectedAreaSpec {
  key: string;
  code: string;
  name: string;
  type: ProtectedAreaType;
  region: string;
  areaHa: number;
  latitude: number;
  longitude: number;
  established: string;
  authority: string;
  description: string;
  biodiversity: string;
  encroachmentRisk: RiskLevel;
}

const PROTECTED_AREAS: ProtectedAreaSpec[] = [
  {
    key: 'korup',
    code: 'PN-KORUP',
    name: 'Parc National de Korup',
    type: ProtectedAreaType.NATIONAL_PARK,
    region: 'Sud-Ouest',
    areaHa: 126_000,
    latitude: 5.09,
    longitude: 8.85,
    established: '1986-10-30',
    authority: 'MINFOF — Parc National de Korup (Mundemba)',
    description:
      "L'une des plus anciennes forêts tropicales humides d'Afrique, créée en 1986 et gérée conjointement par MINFOF et ses partenaires de conservation.",
    biodiversity:
      'Plus de 1 000 espèces végétales recensées, 161 espèces de poissons, primates menacés (drill, chimpanzé) et éléphants de forêt.',
    encroachmentRisk: RiskLevel.HIGH,
  },
  {
    key: 'dja',
    code: 'RB-DJA',
    name: 'Réserve de Biosphère du Dja',
    type: ProtectedAreaType.BIOSPHERE_RESERVE,
    region: 'Sud',
    areaHa: 526_000,
    latitude: 3.05,
    longitude: 13.0,
    established: '1987-06-23',
    authority: 'MINFOF — Réserve de Biosphère du Dja',
    description:
      'Site du patrimoine mondial de l’UNESCO encerclé presque entièrement par la rivière Dja, converti en réserve de biosphère.',
    biodiversity:
      'Forêt dense semi-caduque abritant gorilles des plaines occidentales, bongo et plus de 320 espèces d’oiseaux.',
    encroachmentRisk: RiskLevel.MODERATE,
  },
  {
    key: 'banyang-mbo',
    code: 'SAN-BANYANG-MBO',
    name: 'Sanctuaire de Faune de Banyang-Mbo',
    type: ProtectedAreaType.SANCTUARY,
    region: 'Sud-Ouest',
    areaHa: 68_800,
    latitude: 5.65,
    longitude: 9.45,
    established: '2000-05-11',
    authority: 'MINFOF — Délégation Départementale du Manyu',
    description:
      'Sanctuaire créé pour protéger le chimpanzé de Cross River et l’écureuil de Cooper, avec des zones de chasse communautaire en périphérie.',
    biodiversity: 'Chimpanzé (Pan troglodytes ellioti), drill, céphalophes et forêt de crête dégradée en reconstitution.',
    encroachmentRisk: RiskLevel.MODERATE,
  },
  {
    key: 'douala-edea',
    code: 'RF-DOUALA-EDEA',
    name: 'Réserve de Faune de Douala-Édéa',
    type: ProtectedAreaType.WILDLIFE_RESERVE,
    region: 'Littoral',
    areaHa: 160_000,
    latitude: 3.6,
    longitude: 9.8,
    established: '1932-03-29',
    authority: 'MINFOF — Délégation Départementale de la Sanaga-Maritime',
    description:
      'Réserve historique de 1932 couvrant mangroves, forêts marécageuses et zones humides à l’embouchure du Wouri et de la Sanaga.',
    biodiversity: 'Lamantin d’Afrique, hippopotame nain, crocodile nain et zones de frai importantes pour les poissons côtiers.',
    encroachmentRisk: RiskLevel.CRITICAL,
  },
  {
    key: 'mont-cameroun',
    code: 'FP-MONT-CAMEROUN',
    name: 'Forêt de Protection du Mont Cameroun',
    type: ProtectedAreaType.FOREST_RESERVE,
    region: 'Sud-Ouest',
    areaHa: 41_000,
    latitude: 4.203,
    longitude: 9.17,
    established: '2009-02-17',
    authority: 'MINFOF — Délégation Départementale du Fako',
    description:
      'Ceinture de protection des versants du Mont Cameroun : forêt de montagne, prairies afro-alpines et captages d’eau des villes de Buea et Limbe.',
    biodiversity: 'Forêt afro-montagnarde, caméléon nain du Mont Cameroun et endémiques des pentes volcaniques.',
    encroachmentRisk: RiskLevel.HIGH,
  },
];

interface ForestSpec {
  key: string;
  code: string;
  name: string;
  type: ForestType;
  status: ForestStatus;
  region: string;
  division: string;
  subdivision: string;
  totalAreaHa: number;
  exploitableAreaHa: number;
  latitude: number;
  longitude: number;
  elevationM: number;
  annualAllowableCutM3: number;
  established: string;
  lastInventoried: string;
  protectedAreaKey?: string;
  description: string;
}

const FORESTS: ForestSpec[] = [
  {
    key: 'djoum',
    code: 'FD-DJOUM',
    name: 'Forêt Domaniale de Djoum',
    type: ForestType.PRODUCTION,
    status: ForestStatus.UNDER_MANAGEMENT,
    region: 'Sud',
    division: 'Dja-et-Lobo',
    subdivision: 'Djoum',
    totalAreaHa: 14_250,
    exploitableAreaHa: 9_800,
    latitude: 2.785,
    longitude: 12.835,
    elevationM: 620,
    annualAllowableCutM3: 42_000,
    established: '1998-03-12',
    lastInventoried: '2025-11-04',
    description:
      'Forêt domaniale de production attribuée sous convention définitive, desservie par la route Djoum–Ouesso et un réseau de pistes forestières.',
  },
  {
    key: 'mbalmayo',
    code: 'RF-MBALMAYO',
    name: 'Réserve Forestière de Mbalmayo',
    type: ForestType.MIXED,
    status: ForestStatus.UNDER_MANAGEMENT,
    region: 'Centre',
    division: "Nyong-et-So'o",
    subdivision: 'Mbalmayo',
    totalAreaHa: 7_890,
    exploitableAreaHa: 4_100,
    latitude: 3.517,
    longitude: 11.49,
    elevationM: 640,
    annualAllowableCutM3: 12_500,
    established: '1947-06-01',
    lastInventoried: '2025-08-19',
    description:
      'Réserve historique abritant l’arboretum et le centre de formation forestière de Mbalmayo ; exploitation encadrée et parcelles pédagogiques.',
  },
  {
    key: 'mindourou',
    code: 'FC-MINDOUROU',
    name: 'Forêt Communautaire de Mindourou',
    type: ForestType.COMMUNITY,
    status: ForestStatus.ACTIVE,
    region: 'Est',
    division: 'Haut-Nyong',
    subdivision: 'Mindourou',
    totalAreaHa: 5_180,
    exploitableAreaHa: 3_400,
    latitude: 3.4861,
    longitude: 13.872,
    elevationM: 700,
    annualAllowableCutM3: 6_400,
    established: '2011-09-05',
    lastInventoried: '2026-02-11',
    description:
      'Forêt communautaire gérée par une coopérative villageoise, avec plan simple de gestion quinquennal et zone sacrée exclue de toute coupe.',
  },
  {
    key: 'yokadouma',
    code: 'UFA-YOKADOUMA-10-008',
    name: 'Forêt de Production de Yokadouma (UFA 10-008)',
    type: ForestType.PRODUCTION,
    status: ForestStatus.UNDER_MANAGEMENT,
    region: 'Est',
    division: 'Boumba-et-Ngoko',
    subdivision: 'Yokadouma',
    totalAreaHa: 25_400,
    exploitableAreaHa: 18_600,
    latitude: 3.5,
    longitude: 14.75,
    elevationM: 520,
    annualAllowableCutM3: 68_000,
    established: '2000-01-20',
    lastInventoried: '2025-12-02',
    description:
      'Grande unité forestière d’aménagement du sud-est, exploitée sous plan d’aménagement, avec séries de protection le long des cours d’eau.',
  },
  {
    key: 'bafut',
    code: 'PL-BAFUT-NGEMBA',
    name: 'Plantation Forestière de Bafut-Ngemba',
    type: ForestType.PLANTATION,
    status: ForestStatus.ACTIVE,
    region: 'Nord-Ouest',
    division: 'Mezam',
    subdivision: 'Bafut',
    totalAreaHa: 2_240,
    exploitableAreaHa: 1_600,
    latitude: 6.09,
    longitude: 10.1,
    elevationM: 1_180,
    annualAllowableCutM3: 9_800,
    established: '1978-11-15',
    lastInventoried: '2026-01-23',
    description:
      'Plantation de bois d’œuvre et d’énergie sur les hautes terres de l’Ouest, exploitée par rotation et réensemencée après coupe.',
  },
  {
    key: 'bidou',
    code: 'FD-BIDOU-I',
    name: 'Forêt Domaniale de Bidou I',
    type: ForestType.PRODUCTION,
    status: ForestStatus.UNDER_MANAGEMENT,
    region: 'Sud',
    division: 'Océan',
    subdivision: 'Bipindi',
    totalAreaHa: 11_400,
    exploitableAreaHa: 7_600,
    latitude: 2.95,
    longitude: 9.91,
    elevationM: 340,
    annualAllowableCutM3: 31_000,
    established: '1996-05-30',
    lastInventoried: '2025-09-27',
    description:
      'Forêt côtière proche du port de Kribi, sous pression d’exploitation et de conversion agricole ; suivi renforcé des limites.',
  },
  {
    key: 'korup-buffer',
    code: 'ZP-KORUP-BUFFER',
    name: 'Zone Périphérique du Parc National de Korup',
    type: ForestType.PROTECTION,
    status: ForestStatus.PROTECTED,
    region: 'Sud-Ouest',
    division: 'Ndian',
    subdivision: 'Mundemba',
    totalAreaHa: 3_500,
    exploitableAreaHa: 0,
    latitude: 5.03,
    longitude: 8.87,
    elevationM: 180,
    annualAllowableCutM3: 0,
    established: '1986-10-30',
    lastInventoried: '2025-07-15',
    protectedAreaKey: 'korup',
    description:
      'Bande tampon entre le parc national et les terres agricoles : aucune coupe commerciale, contrôle de l’empiètement et appui aux comités paysans-forêts.',
  },
];

interface ZoneSpec {
  key: string;
  forestKey: string;
  code: string;
  name: string;
  zoneType: ZoneType;
  status: ZoneStatus;
  areaHa: number;
  latitude: number;
  longitude: number;
  maxAnnualYieldM3: number | null;
  conservationPriority: number;
  isProtected: boolean;
  description: string;
  lastHarvestedDaysAgo?: number;
}

const ZONES: ZoneSpec[] = [
  {
    key: 'dj-a',
    forestKey: 'djoum',
    code: 'DJ-A',
    name: 'Assiette annuelle 2026 — Bloc A',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 1_800,
    latitude: 2.795,
    longitude: 12.845,
    maxAnnualYieldM3: 6_500,
    conservationPriority: 1,
    isProtected: false,
    description: 'Assiette de coupe en cours d’exploitation pour la campagne 2026, marquée et inventoriée à 100 %.',
    lastHarvestedDaysAgo: 12,
  },
  {
    key: 'dj-b',
    forestKey: 'djoum',
    code: 'DJ-B',
    name: 'Bloc B — exploitation différée',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 1_650,
    latitude: 2.76,
    longitude: 12.81,
    maxAnnualYieldM3: 5_200,
    conservationPriority: 2,
    isProtected: false,
    description: 'Assiette planifiée pour la campagne suivante ; inventaire d’aménagement terminé.',
  },
  {
    key: 'dj-c',
    forestKey: 'djoum',
    code: 'DJ-C',
    name: 'Série de conservation Dja-Sud',
    zoneType: ZoneType.CONSERVATION,
    status: ZoneStatus.RESTRICTED,
    areaHa: 900,
    latitude: 2.74,
    longitude: 12.87,
    maxAnnualYieldM3: null,
    conservationPriority: 4,
    isProtected: true,
    description: 'Série de conservation incluse dans le plan d’aménagement : zones humides, salines et habitat faunique.',
  },
  {
    key: 'mb-a',
    forestKey: 'mbalmayo',
    code: 'MB-A',
    name: 'Parcelle pilote 12',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 620,
    latitude: 3.53,
    longitude: 11.5,
    maxAnnualYieldM3: 2_100,
    conservationPriority: 1,
    isProtected: false,
    description: 'Parcelle d’exploitation à faible impact utilisée comme démonstration pour les élèves forestiers.',
    lastHarvestedDaysAgo: 46,
  },
  {
    key: 'mb-b',
    forestKey: 'mbalmayo',
    code: 'MB-B',
    name: 'Bande riveraine du Nyong',
    zoneType: ZoneType.BUFFER,
    status: ZoneStatus.RESTRICTED,
    areaHa: 240,
    latitude: 3.505,
    longitude: 11.478,
    maxAnnualYieldM3: null,
    conservationPriority: 5,
    isProtected: true,
    description: 'Bande de 30 m le long du Nyong, maintenue en ripisylve conformément au cahier des charges.',
  },
  {
    key: 'md-a',
    forestKey: 'mindourou',
    code: 'MD-A',
    name: 'Bloc communautaire Nord',
    zoneType: ZoneType.COMMUNITY,
    status: ZoneStatus.ACTIVE,
    areaHa: 1_300,
    latitude: 3.5,
    longitude: 13.88,
    maxAnnualYieldM3: 2_400,
    conservationPriority: 1,
    isProtected: false,
    description: 'Bloc exploité par les membres de la coopérative avec appui technique de la délégation départementale.',
    lastHarvestedDaysAgo: 21,
  },
  {
    key: 'md-b',
    forestKey: 'mindourou',
    code: 'MD-B',
    name: 'Zone sacrée des chutes',
    zoneType: ZoneType.SACRED,
    status: ZoneStatus.RESTRICTED,
    areaHa: 180,
    latitude: 3.478,
    longitude: 13.86,
    maxAnnualYieldM3: null,
    conservationPriority: 5,
    isProtected: true,
    description: 'Site culturel villageois interdit à toute exploitation, mentionné explicitement dans le plan simple de gestion.',
  },
  {
    key: 'yk-a',
    forestKey: 'yokadouma',
    code: 'YK-A',
    name: 'Assiette de coupe 2026 — UFA 10-008 Sud',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 2_400,
    latitude: 3.49,
    longitude: 14.76,
    maxAnnualYieldM3: 12_000,
    conservationPriority: 1,
    isProtected: false,
    description: 'Assiette annuelle en exploitation, desservie par un réseau de pistes classé.',
    lastHarvestedDaysAgo: 5,
  },
  {
    key: 'yk-b',
    forestKey: 'yokadouma',
    code: 'YK-B',
    name: 'Bloc Est — régénération',
    zoneType: ZoneType.REGENERATION,
    status: ZoneStatus.ACTIVE,
    areaHa: 1_100,
    latitude: 3.52,
    longitude: 14.79,
    maxAnnualYieldM3: 4_000,
    conservationPriority: 3,
    isProtected: false,
    description: 'Bloc en régénération après coupe : layons de débardage fermés et inventaire de reconstitution en cours.',
  },
  {
    key: 'yk-c',
    forestKey: 'yokadouma',
    code: 'YK-C',
    name: 'Zones marécageuses protégées',
    zoneType: ZoneType.PROTECTION,
    status: ZoneStatus.RESTRICTED,
    areaHa: 700,
    latitude: 3.47,
    longitude: 14.72,
    maxAnnualYieldM3: null,
    conservationPriority: 4,
    isProtected: true,
    description: 'Bas-fonds marécageux et salines retirés de l’exploitation par le plan d’aménagement.',
  },
  {
    key: 'bf-a',
    forestKey: 'bafut',
    code: 'BF-A',
    name: 'Plantation 1998 — Terminalia et Eucalyptus',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 540,
    latitude: 6.095,
    longitude: 10.105,
    maxAnnualYieldM3: 3_600,
    conservationPriority: 1,
    isProtected: false,
    description: 'Parcelle arrivée à maturité technique, exploitée par bandes alternées puis replantée la même saison.',
    lastHarvestedDaysAgo: 33,
  },
  {
    key: 'bf-b',
    forestKey: 'bafut',
    code: 'BF-B',
    name: 'Périmètre de régénération naturelle',
    zoneType: ZoneType.REGENERATION,
    status: ZoneStatus.ACTIVE,
    areaHa: 320,
    latitude: 6.08,
    longitude: 10.09,
    maxAnnualYieldM3: 1_200,
    conservationPriority: 2,
    isProtected: false,
    description: 'Périmètre protégé du pâturage par une haie vive, suivi par placettes permanentes.',
  },
  {
    key: 'bd-a',
    forestKey: 'bidou',
    code: 'BD-A',
    name: 'Assiette annuelle 2026',
    zoneType: ZoneType.PRODUCTION,
    status: ZoneStatus.ACTIVE,
    areaHa: 1_900,
    latitude: 2.96,
    longitude: 9.92,
    maxAnnualYieldM3: 7_400,
    conservationPriority: 1,
    isProtected: false,
    description: 'Assiette annuelle proche de la route Kribi–Lolabé, contrôle rapproché des volumes déclarés.',
    lastHarvestedDaysAgo: 68,
  },
  {
    key: 'kb-a',
    forestKey: 'korup-buffer',
    code: 'KB-A',
    name: 'Zone tampon périphérique',
    zoneType: ZoneType.BUFFER,
    status: ZoneStatus.RESTRICTED,
    areaHa: 1_400,
    latitude: 5.035,
    longitude: 8.865,
    maxAnnualYieldM3: null,
    conservationPriority: 5,
    isProtected: true,
    description: 'Zone tampon du parc national : aucune coupe commerciale, surveillance de l’empiètement agricole.',
  },
];

interface SpeciesSpec {
  key: string;
  scientificName: string;
  commonName: string;
  familyName: string;
  localName: string;
  iucnStatus: string;
  isProtected: boolean;
  isCommercial: boolean;
  maxHarvestDiameterCm: number;
  minRotationYears: number;
  woodDensityKgM3: number;
  description: string;
}

const SPECIES: SpeciesSpec[] = [
  {
    key: 'ayous',
    scientificName: 'Triplochiton scleroxylon',
    commonName: 'Ayous',
    familyName: 'Malvaceae',
    localName: 'Ayous / Wawa',
    iucnStatus: 'LC',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 80,
    minRotationYears: 30,
    woodDensityKgM3: 390,
    description: 'Essence blanche légère la plus exploitée du Cameroun, utilisée en menuiserie et contreplaqué.',
  },
  {
    key: 'iroko',
    scientificName: 'Milicia excelsa',
    commonName: 'Iroko',
    familyName: 'Moraceae',
    localName: 'Iroko / Abang',
    iucnStatus: 'LC',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 90,
    minRotationYears: 60,
    woodDensityKgM3: 640,
    description: 'Bois durable de construction navale et extérieure ; essence à diamètre minimum de coupe élevé.',
  },
  {
    key: 'sapelli',
    scientificName: 'Entandrophragma cylindricum',
    commonName: 'Sapelli',
    familyName: 'Meliaceae',
    localName: 'Sapelli / Assié',
    iucnStatus: 'VU',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 100,
    minRotationYears: 80,
    woodDensityKgM3: 620,
    description: 'Bois rouge de première qualité, sous pression forte : quotas annuels suivis de près.',
  },
  {
    key: 'sipo',
    scientificName: 'Entandrophragma utile',
    commonName: 'Sipo',
    familyName: 'Meliaceae',
    localName: 'Sipo / Assié',
    iucnStatus: 'VU',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 90,
    minRotationYears: 80,
    woodDensityKgM3: 570,
    description: 'Proche du sapelli, apprécié en ébénisterie et pour les moulures.',
  },
  {
    key: 'moabi',
    scientificName: 'Baillonella toxisperma',
    commonName: 'Moabi',
    familyName: 'Sapotaceae',
    localName: 'Moabi / Afane',
    iucnStatus: 'VU',
    isProtected: true,
    isCommercial: true,
    maxHarvestDiameterCm: 110,
    minRotationYears: 100,
    woodDensityKgM3: 830,
    description:
      'Espèce à protéger : arbre nourricier majeur pour la faune et les communautés. Coupe soumise à autorisation spécifique.',
  },
  {
    key: 'bubinga',
    scientificName: 'Guibourtia tessmannii',
    commonName: 'Bubinga',
    familyName: 'Fabaceae',
    localName: 'Bubinga / Kevazingo',
    iucnStatus: 'VU',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 90,
    minRotationYears: 100,
    woodDensityKgM3: 900,
    description: 'Bois précieux très lourd, exporté en tranches ; utilisation strictement encadrée.',
  },
  {
    key: 'tali',
    scientificName: 'Erythrophleum suaveolens',
    commonName: 'Tali',
    familyName: 'Fabaceae',
    localName: 'Tali / Élok',
    iucnStatus: 'LC',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 80,
    minRotationYears: 50,
    woodDensityKgM3: 830,
    description: 'Bois lourd et résistant, prisé pour les traverses, la construction lourde et le mobilier urbain.',
  },
  {
    key: 'azobe',
    scientificName: 'Lophira alata',
    commonName: 'Azobé',
    familyName: 'Ochnaceae',
    localName: 'Azobé / Bongossi',
    iucnStatus: 'VU',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 90,
    minRotationYears: 80,
    woodDensityKgM3: 1_080,
    description: 'Bois très dense et imputrescible, utilisé en ouvrages maritimes et ferroviaires.',
  },
  {
    key: 'frake',
    scientificName: 'Terminalia superba',
    commonName: 'Fraké',
    familyName: 'Combretaceae',
    localName: 'Fraké / Limba',
    iucnStatus: 'LC',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 80,
    minRotationYears: 40,
    woodDensityKgM3: 560,
    description: 'Essence de croissance rapide, également plantée pour le bois d’énergie sur les hautes terres.',
  },
  {
    key: 'wenge',
    scientificName: 'Millettia laurentii',
    commonName: 'Wengé',
    familyName: 'Fabaceae',
    localName: 'Wengé / Awoung',
    iucnStatus: 'EN',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 70,
    minRotationYears: 80,
    woodDensityKgM3: 870,
    description: 'Bois très décoratif menacé par la surexploitation ; diamètre minimum et quotas renforcés.',
  },
  {
    key: 'ebene',
    scientificName: 'Diospyros crassiflora',
    commonName: 'Ébène',
    familyName: 'Ebenaceae',
    localName: 'Ébène / Mevini',
    iucnStatus: 'EN',
    isProtected: true,
    isCommercial: true,
    maxHarvestDiameterCm: 50,
    minRotationYears: 100,
    woodDensityKgM3: 950,
    description: 'Bois noir très recherché pour les instruments de musique ; espèce en danger, coupe encadrée.',
  },
  {
    key: 'padouk',
    scientificName: 'Pterocarpus soyauxii',
    commonName: 'Padouk',
    familyName: 'Fabaceae',
    localName: 'Padouk / Mbel',
    iucnStatus: 'LC',
    isProtected: false,
    isCommercial: true,
    maxHarvestDiameterCm: 70,
    minRotationYears: 50,
    woodDensityKgM3: 750,
    description: 'Bois rouge orangé utilisé en ébénisterie et pour les instruments ; essence secondaire de valeur.',
  },
  {
    key: 'assamela',
    scientificName: 'Pericopsis elata',
    commonName: 'Assamela',
    familyName: 'Fabaceae',
    localName: 'Assamela / Afrormosia',
    iucnStatus: 'EN',
    isProtected: true,
    isCommercial: true,
    maxHarvestDiameterCm: 80,
    minRotationYears: 90,
    woodDensityKgM3: 700,
    description: 'Essence inscrite à l’annexe II de la CITES : exportation soumise à permis CITES et déclaration de volume.',
  },
];

// ---------------------------------------------------------------------------
// companies and people
// ---------------------------------------------------------------------------

interface CompanySpec {
  key: string;
  name: string;
  registrationNumber: string;
  taxNumber: string;
  type: CompanyType;
  status: CompanyStatus;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
  employeeCount: number;
  description: string;
}

const COMPANIES: CompanySpec[] = [
  {
    key: 'smds',
    name: 'Scierie Moderne du Dja SA',
    registrationNumber: 'RC/DLA/2015/B/0912',
    taxNumber: 'M0715000912F',
    type: CompanyType.LOGGING_COMPANY,
    status: CompanyStatus.VERIFIED,
    email: 'contact@scirie-dja-demo.cm',
    phone: '+237 677 41 20 18',
    addressLine: "Rue de la Scierie, quartier Nkolbikon",
    city: 'Bertoua',
    region: 'Est',
    latitude: 4.5771,
    longitude: 13.6846,
    employeeCount: 184,
    description: 'Entreprise forestière titulaire de conventions définitives dans le Dja-et-Lobo et la Boumba-et-Ngoko.',
  },
  {
    key: 'bsc',
    name: 'Bois du Sud Cameroun SARL',
    registrationNumber: 'RC/EBW/2017/B/1445',
    taxNumber: 'M0817001445C',
    type: CompanyType.SAWMILL,
    status: CompanyStatus.VERIFIED,
    email: 'contact@bois-du-sud-demo.cm',
    phone: '+237 699 12 77 04',
    addressLine: 'Route de Mvangan, zone industrielle',
    city: 'Ebolowa',
    region: 'Sud',
    latitude: 2.9,
    longitude: 11.15,
    employeeCount: 96,
    description: 'Scierie et séchoir alimentés par des permis de coupe communautaires et des ventes de coupe.',
  },
  {
    key: 'efe',
    name: "Exploitation Forestière de l'Est SA",
    registrationNumber: 'RC/BTA/2013/B/0633',
    taxNumber: 'M0713000633R',
    type: CompanyType.LOGGING_COMPANY,
    status: CompanyStatus.VERIFIED,
    email: 'contact@exploitation-est-demo.cm',
    phone: '+237 655 63 09 82',
    addressLine: 'Avenue de la Boumba, quartier administratif',
    city: 'Yokadouma',
    region: 'Est',
    latitude: 3.5167,
    longitude: 14.7667,
    employeeCount: 312,
    description: 'Grande entreprise d’exploitation de l’UFA 10-008, certifiée et suivie pour ses obligations de réhabilitation.',
  },
  {
    key: 'cofcom',
    name: 'Coopérative Forestière Communautaire de Mindourou',
    registrationNumber: 'RC/BTA/2019/C/0221',
    taxNumber: 'M0719000221P',
    type: CompanyType.COOPERATIVE,
    status: CompanyStatus.VERIFIED,
    email: 'cofcom@foret-communautaire-demo.cm',
    phone: '+237 690 55 31 47',
    addressLine: 'Carrefour Mindourou, près du marché central',
    city: 'Mindourou',
    region: 'Est',
    latitude: 3.4861,
    longitude: 13.872,
    employeeCount: 42,
    description: 'Coopérative villageoise exploitant sa forêt communautaire selon un plan simple de gestion quinquennal.',
  },
  {
    key: 'cwpi',
    name: 'Cameroon Wood Processing Industries Ltd',
    registrationNumber: 'RC/DLA/2012/B/0781',
    taxNumber: 'M0612000781D',
    type: CompanyType.WOOD_PROCESSING,
    status: CompanyStatus.VERIFIED,
    email: 'contact@cwpi-demo.cm',
    phone: '+237 233 42 18 90',
    addressLine: 'Zone industrielle de Bassa, boulevard des Nations Unies',
    city: 'Douala',
    region: 'Littoral',
    latitude: 4.0511,
    longitude: 9.7679,
    employeeCount: 268,
    description: 'Transformateur de grumes en déroulage et sciage pour l’export, disposant de ses propres permis d’approvisionnement.',
  },
  {
    key: 'ntt',
    name: 'Nkam Timber Traders SARL',
    registrationNumber: 'RC/DLA/2020/B/2109',
    taxNumber: 'M0620002109E',
    type: CompanyType.TIMBER_TRADER,
    status: CompanyStatus.PENDING,
    email: 'contact@nkam-timber-demo.cm',
    phone: '+237 678 88 45 12',
    addressLine: 'Route de Yabassi, marché au bois',
    city: 'Yabassi',
    region: 'Littoral',
    latitude: 4.4556,
    longitude: 9.9681,
    employeeCount: 18,
    description: 'Négociant en bois en cours de vérification administrative, autorisé uniquement à transporter.',
  },
];

interface UserSpec {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
  role: string;
  companyKey?: string;
  preferredLanguage: 'fr' | 'en';
}

const USERS: UserSpec[] = [
  {
    key: 'admin',
    email: 'demo.admin@fems.cm',
    firstName: 'Aïcha',
    lastName: 'Mbarga',
    phone: '+237 655 00 11 22',
    jobTitle: 'Administratrice FEMS — MINFOF',
    role: 'ADMINISTRATOR',
    preferredLanguage: 'fr',
  },
  {
    key: 'officer',
    email: 'demo.officer@fems.cm',
    firstName: 'Jean-Pierre',
    lastName: 'Etoundi',
    phone: '+237 677 30 44 51',
    jobTitle: 'Chef de service provincial des forêts — Est',
    role: 'GOVERNMENT_FOREST_OFFICER',
    preferredLanguage: 'fr',
  },
  {
    key: 'environment',
    email: 'demo.environment@fems.cm',
    firstName: 'Grace',
    lastName: 'Nkeng',
    phone: '+237 699 74 20 08',
    jobTitle: 'Inspectrice environnementale — MINEPDED',
    role: 'ENVIRONMENTAL_OFFICER',
    preferredLanguage: 'en',
  },
  {
    key: 'inspector',
    email: 'demo.inspector@fems.cm',
    firstName: 'Bertrand',
    lastName: 'Kamdem',
    phone: '+237 690 18 76 33',
    jobTitle: 'Inspecteur forestier — Délégation du Sud',
    role: 'FOREST_INSPECTOR',
    preferredLanguage: 'fr',
  },
  {
    key: 'operator',
    email: 'demo.operator@fems.cm',
    firstName: 'Samuel',
    lastName: 'Njoya',
    phone: '+237 678 92 14 60',
    jobTitle: 'Chef de chantier — Scierie Moderne du Dja',
    role: 'FIELD_OPERATOR',
    companyKey: 'smds',
    preferredLanguage: 'en',
  },
  {
    key: 'company',
    email: 'demo.company@fems.cm',
    firstName: 'Clarisse',
    lastName: 'Abena',
    phone: '+237 677 65 03 91',
    jobTitle: 'Responsable juridique — Scierie Moderne du Dja',
    role: 'COMPANY_REPRESENTATIVE',
    companyKey: 'smds',
    preferredLanguage: 'fr',
  },
  {
    key: 'company2',
    email: 'demo.cooperative@fems.cm',
    firstName: 'Emmanuel',
    lastName: 'Mvondo',
    phone: '+237 655 27 84 19',
    jobTitle: 'Président — COFCOM Mindourou',
    role: 'COMPANY_REPRESENTATIVE',
    companyKey: 'cofcom',
    preferredLanguage: 'fr',
  },
  {
    key: 'company3',
    email: 'demo.efe@fems.cm',
    firstName: 'Nadège',
    lastName: 'Bella',
    phone: '+237 677 12 88 40',
    jobTitle: "Responsable exploitation — Exploitation Forestière de l'Est",
    role: 'COMPANY_REPRESENTATIVE',
    companyKey: 'efe',
    preferredLanguage: 'fr',
  },
  {
    key: 'company4',
    email: 'demo.bsc@fems.cm',
    firstName: 'Alain',
    lastName: 'Ndongo',
    phone: '+237 699 46 17 23',
    jobTitle: 'Directeur — Bois du Sud Cameroun SARL',
    role: 'COMPANY_REPRESENTATIVE',
    companyKey: 'bsc',
    preferredLanguage: 'fr',
  },
  {
    key: 'company5',
    email: 'demo.cwpi@fems.cm',
    firstName: 'Esther',
    lastName: 'Mbongo',
    phone: '+237 655 90 32 15',
    jobTitle: 'Responsable approvisionnement — CWP Industries',
    role: 'COMPANY_REPRESENTATIVE',
    companyKey: 'cwpi',
    preferredLanguage: 'en',
  },
  {
    key: 'explorer',
    email: 'demo.explorer@fems.cm',
    firstName: 'Léonie',
    lastName: 'Fotso',
    phone: '+237 690 40 62 77',
    jobTitle: 'Étudiante en foresterie — Mbalmayo',
    role: 'FOREST_EXPLORER',
    preferredLanguage: 'fr',
  },
  {
    key: 'visitor',
    email: 'demo.visitor@fems.cm',
    firstName: 'Peter',
    lastName: 'Ayuk',
    phone: '+237 678 51 30 26',
    jobTitle: 'Chercheur invité — Université de Buea',
    role: 'VISITOR',
    preferredLanguage: 'en',
  },
];

// ---------------------------------------------------------------------------
// permits, activities, money, controls
// ---------------------------------------------------------------------------

interface PermitSpec {
  key: string;
  permitNumber: string;
  type: PermitType;
  status: PermitStatus;
  priority: PermitPriority;
  title: string;
  purpose: string;
  companyKey: string;
  forestKey: string;
  zoneKey?: string;
  volumeRequestedM3: number;
  volumeApprovedM3?: number;
  areaRequestedHa?: number;
  startDays: number;
  endDays: number;
  submittedDays?: number;
  reviewStartedDays?: number;
  reviewedDays?: number;
  approvedDays?: number;
  activatedDays?: number;
  expiresDays?: number;
  rejectionReason?: string;
  suspensionReason?: string;
  revisionNotes?: string;
  revisionCount?: number;
  conditions?: string;
}

const ROYALTY_RATE = 2_500;

const PERMITS: PermitSpec[] = [
  {
    key: 'p1',
    permitNumber: 'DEMO-EXP-2026-0001',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.ACTIVE,
    priority: PermitPriority.HIGH,
    title: 'Exploitation de l’assiette annuelle 2026 — Bloc A, Djoum',
    purpose:
      'Récolte sélective de sapelli, iroko et ayous sur l’assiette annuelle 2026 du bloc A, dans la limite du volume approuvé.',
    companyKey: 'smds',
    forestKey: 'djoum',
    zoneKey: 'dj-a',
    volumeRequestedM3: 6_500,
    volumeApprovedM3: 6_500,
    areaRequestedHa: 1_800,
    startDays: -240,
    endDays: 125,
    submittedDays: -300,
    reviewStartedDays: -290,
    reviewedDays: -280,
    approvedDays: -270,
    activatedDays: -260,
    expiresDays: 125,
    conditions:
      'Respect du diamètre minimum de coupe par essence ; maintien des bandes riveraines de 30 m ; remise du registre de coupe au plus tard le 5 de chaque mois ; réhabilitation des pistes en fin de campagne.',
  },
  {
    key: 'p2',
    permitNumber: 'DEMO-EXP-2026-0002',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.PAYMENT_PENDING,
    priority: PermitPriority.NORMAL,
    title: 'Exploitation du bloc B — Djoum (campagne 2026-2027)',
    purpose: 'Ouverture du bloc B différé après inventaire d’aménagement complet.',
    companyKey: 'smds',
    forestKey: 'djoum',
    zoneKey: 'dj-b',
    volumeRequestedM3: 5_200,
    volumeApprovedM3: 5_200,
    areaRequestedHa: 1_650,
    startDays: -20,
    endDays: 345,
    submittedDays: -95,
    reviewStartedDays: -90,
    reviewedDays: -75,
    approvedDays: -24,
    conditions: 'Le permis devient opérationnel dès réception de la taxe d’exploitation ; aucun abattage avant activation.',
  },
  {
    key: 'p3',
    permitNumber: 'DEMO-EXP-2026-0003',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.ACTIVE,
    priority: PermitPriority.URGENT,
    title: 'Exploitation UFA 10-008 — assiette 2026 Sud',
    purpose: 'Campagne annuelle de l’UFA 10-008, assiette Sud, avec obligation de réhabilitation des pistes classées.',
    companyKey: 'efe',
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    volumeRequestedM3: 12_000,
    volumeApprovedM3: 12_000,
    areaRequestedHa: 2_400,
    startDays: -300,
    endDays: 60,
    submittedDays: -380,
    reviewStartedDays: -370,
    reviewedDays: -350,
    approvedDays: -340,
    activatedDays: -330,
    expiresDays: 60,
    conditions:
      'Quotas par essence contrôlés mensuellement ; respect des séries de protection ; rapport d’inventaire d’exploitation à déposer sous 30 jours après la campagne.',
  },
  {
    key: 'p4',
    permitNumber: 'DEMO-EXP-2026-0004',
    type: PermitType.COMMUNITY_FOREST,
    status: PermitStatus.ACTIVE,
    priority: PermitPriority.NORMAL,
    title: 'Exploitation de la forêt communautaire de Mindourou',
    purpose: 'Exploitation communautaire du bloc Nord avec appui technique de la délégation départementale.',
    companyKey: 'cofcom',
    forestKey: 'mindourou',
    zoneKey: 'md-a',
    volumeRequestedM3: 2_400,
    volumeApprovedM3: 2_400,
    areaRequestedHa: 1_300,
    startDays: -150,
    endDays: 210,
    submittedDays: -210,
    reviewStartedDays: -205,
    reviewedDays: -190,
    approvedDays: -175,
    activatedDays: -160,
    expiresDays: 210,
    conditions: 'Zone sacrée exclue de toute coupe ; 15 % des recettes affectés au développement villageois.',
  },
  {
    key: 'p5',
    permitNumber: 'DEMO-EXP-2026-0005',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.UNDER_REVIEW,
    priority: PermitPriority.NORMAL,
    title: 'Exploitation de la parcelle pilote 12 — Mbalmayo',
    purpose: 'Demande d’exploitation à faible impact sur la parcelle pilote, à des fins pédagogiques.',
    companyKey: 'bsc',
    forestKey: 'mbalmayo',
    zoneKey: 'mb-a',
    volumeRequestedM3: 2_100,
    areaRequestedHa: 620,
    startDays: 45,
    endDays: 400,
    submittedDays: -30,
    reviewStartedDays: -18,
  },
  {
    key: 'p6',
    permitNumber: 'DEMO-EXP-2026-0006',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.SUBMITTED,
    priority: PermitPriority.HIGH,
    title: 'Exploitation de l’assiette 2026 — Bidou I',
    purpose: 'Demande d’ouverture de l’assiette annuelle de la forêt domaniale de Bidou I.',
    companyKey: 'cwpi',
    forestKey: 'bidou',
    zoneKey: 'bd-a',
    volumeRequestedM3: 7_400,
    areaRequestedHa: 1_900,
    startDays: 30,
    endDays: 395,
    submittedDays: -6,
  },
  {
    key: 'p7',
    permitNumber: 'DEMO-EXP-2025-0007',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.EXPIRED,
    priority: PermitPriority.NORMAL,
    title: 'Exploitation 2025 — Bloc A, Djoum (campagne close)',
    purpose: 'Campagne 2025 achevée ; le permis n’est plus opérationnel et l’inventaire de reconstitution a été déposé.',
    companyKey: 'smds',
    forestKey: 'djoum',
    zoneKey: 'dj-a',
    volumeRequestedM3: 6_200,
    volumeApprovedM3: 6_200,
    areaRequestedHa: 1_800,
    startDays: -600,
    endDays: -240,
    submittedDays: -690,
    reviewedDays: -660,
    approvedDays: -650,
    activatedDays: -640,
    expiresDays: -240,
  },
  {
    key: 'p8',
    permitNumber: 'DEMO-EXP-2026-0008',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.REJECTED,
    priority: PermitPriority.LOW,
    title: 'Demande d’exploitation — Bidou I (société non vérifiée)',
    purpose: 'Demande rejetée : le dossier administratif de l’entreprise n’est pas complet.',
    companyKey: 'ntt',
    forestKey: 'bidou',
    volumeRequestedM3: 3_000,
    startDays: 60,
    endDays: 425,
    submittedDays: -85,
    reviewStartedDays: -80,
    reviewedDays: -60,
    rejectionReason:
      'Attestation de conformité fiscale expirée et absence de plan d’aménagement approuvé pour l’assiette demandée.',
  },
  {
    key: 'p9',
    permitNumber: 'DEMO-EXP-2026-0009',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.SUSPENDED,
    priority: PermitPriority.URGENT,
    title: 'Exploitation UFA 10-008 — bloc Est (suspendue)',
    purpose: 'Permis suspendu à la suite de l’inspection de conformité du bloc Est.',
    companyKey: 'efe',
    forestKey: 'yokadouma',
    zoneKey: 'yk-b',
    volumeRequestedM3: 4_000,
    volumeApprovedM3: 4_000,
    areaRequestedHa: 1_100,
    startDays: -190,
    endDays: 175,
    submittedDays: -260,
    reviewedDays: -235,
    approvedDays: -225,
    activatedDays: -215,
    expiresDays: 175,
    suspensionReason:
      'Ouverture d’une piste à moins de 30 m d’un cours d’eau constatée lors de l’inspection INS-DEMO-0003 : suspension jusqu’à réhabilitation.',
  },
  {
    key: 'p10',
    permitNumber: 'DEMO-EXP-2026-0010',
    type: PermitType.EXPLOITATION,
    status: PermitStatus.REVISION_REQUIRED,
    priority: PermitPriority.NORMAL,
    title: 'Exploitation du bloc communautaire Sud — Mindourou',
    purpose: 'Dossier à compléter : délimitation contradictoire du bloc Sud non encore validée.',
    companyKey: 'cofcom',
    forestKey: 'mindourou',
    volumeRequestedM3: 1_800,
    areaRequestedHa: 900,
    startDays: 75,
    endDays: 440,
    submittedDays: -25,
    reviewStartedDays: -20,
    revisionNotes:
      'Joindre le procès-verbal de délimitation contradictoire signé du chef de village et le croquis de l’assiette.',
    revisionCount: 1,
  },
  {
    key: 'p11',
    permitNumber: 'DEMO-TRA-2026-0011',
    type: PermitType.TRANSPORT,
    status: PermitStatus.ACTIVE,
    priority: PermitPriority.NORMAL,
    title: 'Transport de grumes Djoum → Bertoua',
    purpose: 'Autorisation de transport routier de grumes et débités vers les usines de Bertoua et Douala.',
    companyKey: 'smds',
    forestKey: 'djoum',
    volumeRequestedM3: 4_500,
    volumeApprovedM3: 4_500,
    startDays: -120,
    endDays: 240,
    submittedDays: -170,
    reviewedDays: -150,
    approvedDays: -140,
    activatedDays: -130,
    expiresDays: 240,
  },
  {
    key: 'p12',
    permitNumber: 'DEMO-PRO-2026-0012',
    type: PermitType.PROCESSING,
    status: PermitStatus.ACTIVE,
    priority: PermitPriority.HIGH,
    title: 'Transformation industrielle — usine de Bassa',
    purpose: 'Autorisation de transformation du bois dans l’unité industrielle de Bassa (déroulage et sciage).',
    companyKey: 'cwpi',
    forestKey: 'bidou',
    volumeRequestedM3: 9_000,
    volumeApprovedM3: 9_000,
    startDays: -400,
    endDays: 330,
    submittedDays: -470,
    reviewedDays: -450,
    approvedDays: -430,
    activatedDays: -420,
    expiresDays: 330,
  },
];

interface ActivitySpec {
  key: string;
  permitKey: string;
  activityType: ActivityType;
  status: ActivityStatus;
  plannedVolumeM3: number;
  harvestedVolumeM3: number;
  harvestedTreeCount: number;
  plannedStartDays: number;
  plannedEndDays: number;
  actualStartDays?: number;
  actualEndDays?: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  gpsCapturedDays: number;
  equipmentSummary: string;
  observations: string;
  species: Array<{ speciesKey: string; volumeM3: number; trees: number }>;
  assignedTo: 'operator' | 'company';
  clientRef: string;
  syncStatus: SyncStatus;
}

const ACTIVITIES: ActivitySpec[] = [
  {
    key: 'a1',
    permitKey: 'p1',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 1_150,
    harvestedVolumeM3: 1_142,
    harvestedTreeCount: 268,
    plannedStartDays: -230,
    plannedEndDays: -190,
    actualStartDays: -229,
    actualEndDays: -191,
    latitude: 2.7962,
    longitude: 12.8469,
    accuracyM: 6.4,
    gpsCapturedDays: -229,
    equipmentSummary: '2 tronçonneuses Stihl MS 881, 1 skidder Caterpillar 525C, 1 débusqueuse',
    observations:
      'Exploitation conforme au marquage : 268 arbres abattus sur 275 marqués, 7 arbres reportés pour cause de vent dominant.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 640, trees: 121 },
      { speciesKey: 'iroko', volumeM3: 318, trees: 92 },
      { speciesKey: 'ayous', volumeM3: 184, trees: 55 },
    ],
    assignedTo: 'operator',
    clientRef: 'demo-act-0001',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a2',
    permitKey: 'p1',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.IN_PROGRESS,
    plannedVolumeM3: 1_320,
    harvestedVolumeM3: 826,
    harvestedTreeCount: 173,
    plannedStartDays: -60,
    plannedEndDays: 25,
    actualStartDays: -58,
    latitude: 2.8021,
    longitude: 12.8534,
    accuracyM: 4.9,
    gpsCapturedDays: -3,
    equipmentSummary: '3 tronçonneuses, 1 skidder, 1 camion grumier',
    observations: 'Campagne en cours ; abattage suspendu deux jours pour pluies fortes.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 410, trees: 74 },
      { speciesKey: 'tali', volumeM3: 246, trees: 61 },
      { speciesKey: 'frake', volumeM3: 170, trees: 38 },
    ],
    assignedTo: 'operator',
    clientRef: 'demo-act-0002',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a3',
    permitKey: 'p1',
    activityType: ActivityType.LOG_TRANSPORT,
    status: ActivityStatus.IN_PROGRESS,
    plannedVolumeM3: 900,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: -40,
    plannedEndDays: 30,
    actualStartDays: -39,
    latitude: 2.7915,
    longitude: 12.8402,
    accuracyM: 8.1,
    gpsCapturedDays: -1,
    equipmentSummary: '4 camions grumiers, 1 chargeur frontal',
    observations: 'Rotation de transport vers la scierie de Bertoua ; pesée au pont-bascule consignée par bordereau.',
    species: [],
    assignedTo: 'operator',
    clientRef: 'demo-act-0003',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a4',
    permitKey: 'p1',
    activityType: ActivityType.FOREST_SURVEY,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: -120,
    plannedEndDays: -105,
    actualStartDays: -120,
    actualEndDays: -104,
    latitude: 2.7702,
    longitude: 12.8603,
    accuracyM: 5.2,
    gpsCapturedDays: -120,
    equipmentSummary: '2 GPS différentiels, 1 drone de cartographie, compas forestiers',
    observations: 'Inventaire du bloc B : 42 placettes de 0,5 ha, taux de sondage 2 %.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 0, trees: 138 },
      { speciesKey: 'azobe', volumeM3: 0, trees: 44 },
      { speciesKey: 'padouk', volumeM3: 0, trees: 61 },
    ],
    assignedTo: 'operator',
    clientRef: 'demo-act-0004',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a5',
    permitKey: 'p1',
    activityType: ActivityType.SITE_CLEARING,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 45,
    harvestedVolumeM3: 45,
    harvestedTreeCount: 6,
    plannedStartDays: -95,
    plannedEndDays: -88,
    actualStartDays: -95,
    actualEndDays: -88,
    latitude: 2.7892,
    longitude: 12.8338,
    accuracyM: 7.3,
    gpsCapturedDays: -95,
    equipmentSummary: '1 bulldozer Komatsu D65, 1 niveleuse',
    observations: 'Ouverture de la piste d’accès principale, fossés drainants mis en place tous les 50 m.',
    species: [],
    assignedTo: 'operator',
    clientRef: 'demo-act-0005',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a6',
    permitKey: 'p3',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 3_400,
    harvestedVolumeM3: 3_388,
    harvestedTreeCount: 742,
    plannedStartDays: -290,
    plannedEndDays: -230,
    actualStartDays: -289,
    actualEndDays: -228,
    latitude: 3.4923,
    longitude: 14.7649,
    accuracyM: 5.8,
    gpsCapturedDays: -289,
    equipmentSummary: '4 abatteuses, 2 débusqueuses, 1 porteur',
    observations: 'Assiette exploitée par bandes ; 12 arbres de plus de 100 cm laissés comme semenciers.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 1_480, trees: 288 },
      { speciesKey: 'sipo', volumeM3: 1_120, trees: 246 },
      { speciesKey: 'bubinga', volumeM3: 788, trees: 208 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0006',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a7',
    permitKey: 'p3',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.IN_PROGRESS,
    plannedVolumeM3: 2_600,
    harvestedVolumeM3: 2_921,
    harvestedTreeCount: 631,
    plannedStartDays: -70,
    plannedEndDays: 20,
    actualStartDays: -68,
    latitude: 3.4862,
    longitude: 14.7568,
    accuracyM: 4.4,
    gpsCapturedDays: -2,
    equipmentSummary: '4 abatteuses, 2 débusqueuses',
    observations:
      'Volume déclaré supérieur au prévisionnel de la bande 3 : un contrôle des cubages contradictoires a été demandé.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 1_640, trees: 312 },
      { speciesKey: 'iroko', volumeM3: 690, trees: 184 },
      { speciesKey: 'tali', volumeM3: 591, trees: 135 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0007',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a8',
    permitKey: 'p3',
    activityType: ActivityType.ROAD_CONSTRUCTION,
    status: ActivityStatus.SUSPENDED,
    plannedVolumeM3: 120,
    harvestedVolumeM3: 96,
    harvestedTreeCount: 14,
    plannedStartDays: -85,
    plannedEndDays: -40,
    actualStartDays: -84,
    latitude: 3.5134,
    longitude: 14.7881,
    accuracyM: 6.9,
    gpsCapturedDays: -55,
    equipmentSummary: '1 bulldozer, 1 niveleuse, 1 compacteur',
    observations:
      'Piste ouverte à 22 m d’un cours d’eau : travaux arrêtés, tracé à reprendre selon l’avis de l’inspection INS-DEMO-0003.',
    species: [],
    assignedTo: 'company',
    clientRef: 'demo-act-0008',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a9',
    permitKey: 'p3',
    activityType: ActivityType.MAINTENANCE,
    status: ActivityStatus.PLANNED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: 18,
    plannedEndDays: 42,
    latitude: 3.4701,
    longitude: 14.7392,
    accuracyM: 9.7,
    gpsCapturedDays: -1,
    equipmentSummary: '1 niveleuse, 1 camion-citerne',
    observations: 'Reprise des fossés avant la saison des pluies sur 14 km de pistes classées.',
    species: [],
    assignedTo: 'company',
    clientRef: 'demo-act-0009',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a10',
    permitKey: 'p3',
    activityType: ActivityType.PLANTING,
    status: ActivityStatus.SCHEDULED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: 55,
    plannedEndDays: 95,
    latitude: 3.5217,
    longitude: 14.7906,
    accuracyM: 11.2,
    gpsCapturedDays: -4,
    equipmentSummary: '2 camions, matériel de pépinière',
    observations: 'Reboisement de 120 ha en essence Terminalia et Entandrophragma issus de la pépinière de Yokadouma.',
    species: [],
    assignedTo: 'company',
    clientRef: 'demo-act-0010',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a11',
    permitKey: 'p4',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 780,
    harvestedVolumeM3: 762,
    harvestedTreeCount: 194,
    plannedStartDays: -140,
    plannedEndDays: -110,
    actualStartDays: -139,
    actualEndDays: -109,
    latitude: 3.5013,
    longitude: 13.8824,
    accuracyM: 7.8,
    gpsCapturedDays: -139,
    equipmentSummary: '2 tronçonneuses, 1 débardeur agricole adapté',
    observations: 'Exploitation communautaire réalisée avec appui d’un technicien de la délégation.',
    species: [
      { speciesKey: 'ayous', volumeM3: 352, trees: 96 },
      { speciesKey: 'frake', volumeM3: 226, trees: 58 },
      { speciesKey: 'padouk', volumeM3: 184, trees: 40 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0011',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a12',
    permitKey: 'p4',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.IN_PROGRESS,
    plannedVolumeM3: 620,
    harvestedVolumeM3: 214,
    harvestedTreeCount: 56,
    plannedStartDays: -18,
    plannedEndDays: 35,
    actualStartDays: -17,
    latitude: 3.4932,
    longitude: 13.8701,
    accuracyM: 6.1,
    gpsCapturedDays: -6,
    equipmentSummary: '2 tronçonneuses, 1 tracteur avec remorque forestière',
    observations: 'Le bloc est exploité en dehors de la zone sacrée, balisée par des piquets peints.',
    species: [
      { speciesKey: 'ayous', volumeM3: 124, trees: 34 },
      { speciesKey: 'tali', volumeM3: 90, trees: 22 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0012',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a13',
    permitKey: 'p11',
    activityType: ActivityType.LOG_TRANSPORT,
    status: ActivityStatus.IN_PROGRESS,
    plannedVolumeM3: 2_200,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: -35,
    plannedEndDays: 60,
    actualStartDays: -34,
    latitude: 2.8004,
    longitude: 12.8421,
    accuracyM: 5.5,
    gpsCapturedDays: -2,
    equipmentSummary: '5 camions grumiers, 2 chargeurs',
    observations: 'Transport vers Bertoua et Douala ; chaque convoi est accompagné d’un bordereau de transport FEMS.',
    species: [],
    assignedTo: 'operator',
    clientRef: 'demo-act-0013',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a14',
    permitKey: 'p12',
    activityType: ActivityType.SALVAGE_LOGGING,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 640,
    harvestedVolumeM3: 628,
    harvestedTreeCount: 88,
    plannedStartDays: -180,
    plannedEndDays: -150,
    actualStartDays: -179,
    actualEndDays: -149,
    latitude: 2.9534,
    longitude: 9.9142,
    accuracyM: 6.7,
    gpsCapturedDays: -179,
    equipmentSummary: '2 tronçonneuses, 1 porteur',
    observations:
      'Récupération du bois chablis après tempête ; aucune coupe d’arbre sur pied en dehors des arbres dangereux.',
    species: [
      { speciesKey: 'azobe', volumeM3: 318, trees: 42 },
      { speciesKey: 'tali', volumeM3: 310, trees: 46 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0014',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a15',
    permitKey: 'p12',
    activityType: ActivityType.MAINTENANCE,
    status: ActivityStatus.PLANNED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: 26,
    plannedEndDays: 48,
    latitude: 2.9488,
    longitude: 9.9053,
    accuracyM: 10.4,
    gpsCapturedDays: -3,
    equipmentSummary: '1 niveleuse, 1 camion atelier',
    observations: 'Entretien du parc à grumes et remise en état des aires de sciage.',
    species: [],
    assignedTo: 'company',
    clientRef: 'demo-act-0015',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a16',
    permitKey: 'p5',
    activityType: ActivityType.FOREST_SURVEY,
    status: ActivityStatus.COMPLETED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: -55,
    plannedEndDays: -40,
    actualStartDays: -55,
    actualEndDays: -41,
    latitude: 3.5342,
    longitude: 11.5043,
    accuracyM: 5.1,
    gpsCapturedDays: -55,
    equipmentSummary: '3 GPS de terrain, 1 clinomètre, fiches d’inventaire numériques',
    observations: 'Inventaire pédagogique de la parcelle 12 : 18 placettes installées par les élèves de Mbalmayo.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 0, trees: 96 },
      { speciesKey: 'iroko', volumeM3: 0, trees: 58 },
      { speciesKey: 'frake', volumeM3: 0, trees: 74 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0016',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a17',
    permitKey: 'p9',
    activityType: ActivityType.TIMBER_HARVEST,
    status: ActivityStatus.SUSPENDED,
    plannedVolumeM3: 900,
    harvestedVolumeM3: 604,
    harvestedTreeCount: 142,
    plannedStartDays: -110,
    plannedEndDays: -20,
    actualStartDays: -108,
    latitude: 3.5232,
    longitude: 14.7923,
    accuracyM: 6.2,
    gpsCapturedDays: -48,
    equipmentSummary: '2 abatteuses, 1 débusqueuse',
    observations: 'Activité interrompue après la suspension du permis DEMO-EXP-2026-0009.',
    species: [
      { speciesKey: 'sapelli', volumeM3: 372, trees: 86 },
      { speciesKey: 'wenge', volumeM3: 232, trees: 56 },
    ],
    assignedTo: 'company',
    clientRef: 'demo-act-0017',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a18',
    permitKey: 'p4',
    activityType: ActivityType.SITE_CLEARING,
    status: ActivityStatus.PLANNED,
    plannedVolumeM3: 20,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: 40,
    plannedEndDays: 52,
    latitude: 3.4907,
    longitude: 13.8762,
    accuracyM: 8.8,
    gpsCapturedDays: -2,
    equipmentSummary: '1 tracteur avec lame',
    observations: 'Ouverture de deux layons de débardage avec maintien des arbres d’avenir.',
    species: [],
    assignedTo: 'company',
    clientRef: 'demo-act-0018',
    syncStatus: SyncStatus.SYNCED,
  },
  {
    key: 'a19',
    permitKey: 'p1',
    activityType: ActivityType.MAINTENANCE,
    status: ActivityStatus.CANCELLED,
    plannedVolumeM3: 0,
    harvestedVolumeM3: 0,
    harvestedTreeCount: 0,
    plannedStartDays: -30,
    plannedEndDays: -10,
    latitude: 2.7833,
    longitude: 12.8301,
    accuracyM: 9.1,
    gpsCapturedDays: -31,
    equipmentSummary: '1 niveleuse',
    observations: 'Travaux annulés : la piste a été reprise par la commune de Djoum dans le cadre du budget communal.',
    species: [],
    assignedTo: 'operator',
    clientRef: 'demo-act-0019',
    syncStatus: SyncStatus.SYNCED,
  },
];

interface PaymentSpec {
  key: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  method: PaymentMethod;
  amount: number;
  permitKey?: string;
  violationKey?: string;
  initiatedDays: number;
  processedDays?: number;
  paidDays?: number;
  verifiedDays?: number;
  payer: 'company' | 'company2';
  notes: string;
}

const PAYMENTS: PaymentSpec[] = [
  {
    key: 'pay1',
    purpose: PaymentPurpose.PERMIT_FEE,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.MOBILE_MONEY_MTN,
    amount: 16_250_000,
    permitKey: 'p1',
    initiatedDays: -268,
    processedDays: -268,
    paidDays: -267,
    verifiedDays: -266,
    payer: 'company',
    notes: 'Taxe d’exploitation du permis DEMO-EXP-2026-0001 (6 500 m³ × 2 500 XAF).',
  },
  {
    key: 'pay2',
    purpose: PaymentPurpose.ROYALTY,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.MOBILE_MONEY_ORANGE,
    amount: 4_800_000,
    permitKey: 'p1',
    initiatedDays: -120,
    processedDays: -120,
    paidDays: -119,
    verifiedDays: -118,
    payer: 'company',
    notes: 'Redevance forestière du premier trimestre 2026 (1 920 m³ déclarés).',
  },
  {
    key: 'pay3',
    purpose: PaymentPurpose.ROYALTY,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.MOBILE_MONEY_MTN,
    amount: 2_150_000,
    permitKey: 'p1',
    initiatedDays: -45,
    processedDays: -45,
    paidDays: -44,
    verifiedDays: -43,
    payer: 'company',
    notes: 'Redevance forestière du deuxième trimestre 2026 (860 m³ déclarés).',
  },
  {
    key: 'pay4',
    purpose: PaymentPurpose.PERMIT_FEE,
    status: PaymentStatus.PENDING,
    method: PaymentMethod.MOBILE_MONEY_ORANGE,
    amount: 13_000_000,
    permitKey: 'p2',
    initiatedDays: -18,
    payer: 'company',
    notes: 'Taxe du permis DEMO-EXP-2026-0002 en attente de confirmation par l’opérateur de paiement.',
  },
  {
    key: 'pay5',
    purpose: PaymentPurpose.PERMIT_FEE,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.BANK_TRANSFER,
    amount: 30_000_000,
    permitKey: 'p3',
    initiatedDays: -336,
    processedDays: -334,
    paidDays: -332,
    verifiedDays: -330,
    payer: 'company2',
    notes: 'Taxe d’exploitation de l’UFA 10-008 (12 000 m³ × 2 500 XAF), virement bancaire.',
  },
  {
    key: 'pay6',
    purpose: PaymentPurpose.ROYALTY,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.BANK_TRANSFER,
    amount: 8_470_000,
    permitKey: 'p3',
    initiatedDays: -60,
    processedDays: -59,
    paidDays: -58,
    verifiedDays: -57,
    payer: 'company2',
    notes: 'Redevance forestière sur 3 388 m³ (campagne de la bande 1).',
  },
  {
    key: 'pay7',
    purpose: PaymentPurpose.REPLANTING_BOND,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.BANK_TRANSFER,
    amount: 5_000_000,
    permitKey: 'p3',
    initiatedDays: -320,
    processedDays: -319,
    paidDays: -318,
    verifiedDays: -316,
    payer: 'company2',
    notes: 'Caution de reboisement bloquée pour la campagne 2026.',
  },
  {
    key: 'pay8',
    purpose: PaymentPurpose.ANNUAL_TAX,
    status: PaymentStatus.FAILED,
    method: PaymentMethod.MOBILE_MONEY_MTN,
    amount: 1_250_000,
    permitKey: 'p3',
    initiatedDays: -95,
    processedDays: -95,
    payer: 'company2',
    notes: 'Échec du prélèvement : solde insuffisant. La taxe annuelle reste due.',
  },
  {
    key: 'pay9',
    purpose: PaymentPurpose.PERMIT_FEE,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.MOBILE_MONEY_MTN,
    amount: 6_000_000,
    permitKey: 'p4',
    initiatedDays: -172,
    processedDays: -172,
    paidDays: -171,
    verifiedDays: -170,
    payer: 'company2',
    notes: 'Taxe d’exploitation de la forêt communautaire de Mindourou (2 400 m³ × 2 500 XAF).',
  },
  {
    key: 'pay10',
    purpose: PaymentPurpose.ROYALTY,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.MOBILE_MONEY_ORANGE,
    amount: 1_905_000,
    permitKey: 'p4',
    initiatedDays: -40,
    processedDays: -40,
    paidDays: -39,
    verifiedDays: -38,
    payer: 'company2',
    notes: 'Redevance forestière sur 762 m³ déclarés par la coopérative.',
  },
  {
    key: 'pay11',
    purpose: PaymentPurpose.PENALTY,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.BANK_TRANSFER,
    amount: 4_500_000,
    permitKey: 'p3',
    violationKey: 'v3',
    initiatedDays: -58,
    processedDays: -57,
    paidDays: -56,
    verifiedDays: -55,
    payer: 'company2',
    notes: 'Règlement de l’amende relative au chantier de la rivière Kadey (dossier DEMO-VIO-2026-0003).',
  },
  {
    key: 'pay12',
    purpose: PaymentPurpose.PERMIT_FEE,
    status: PaymentStatus.SUCCESSFUL,
    method: PaymentMethod.CARD,
    amount: 22_500_000,
    permitKey: 'p12',
    initiatedDays: -424,
    processedDays: -423,
    paidDays: -422,
    verifiedDays: -421,
    payer: 'company',
    notes: 'Autorisation de transformation industrielle — usine de Bassa (9 000 m³ × 2 500 XAF).',
  },
  {
    key: 'pay13',
    purpose: PaymentPurpose.ROYALTY,
    status: PaymentStatus.REFUNDED,
    method: PaymentMethod.MOBILE_MONEY_AIRTEL,
    amount: 640_000,
    permitKey: 'p6',
    initiatedDays: -70,
    processedDays: -69,
    paidDays: -68,
    verifiedDays: -67,
    payer: 'company',
    notes: 'Redevance versée par erreur avant l’instruction du dossier ; remboursée intégralement.',
  },
  {
    key: 'pay14',
    purpose: PaymentPurpose.OTHER,
    status: PaymentStatus.CANCELLED,
    method: PaymentMethod.MOBILE_MONEY_MTN,
    amount: 300_000,
    permitKey: 'p2',
    initiatedDays: -30,
    payer: 'company',
    notes: 'Paiement annulé par l’entreprise avant validation.',
  },
];

interface InspectionSpec {
  key: string;
  reference: string;
  type: InspectionType;
  status: InspectionStatus;
  outcome?: InspectionOutcome;
  complianceScore?: number;
  title: string;
  summary: string;
  recommendations: string;
  forestKey: string;
  zoneKey?: string;
  protectedAreaKey?: string;
  companyKey?: string;
  permitKey?: string;
  activityKey?: string;
  inspector: 'inspector' | 'environment' | 'officer';
  scheduledDays: number;
  startedDays?: number;
  completedDays?: number;
  submittedDays?: number;
  reviewedDays?: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  gpsCapturedDays: number;
  distanceFromTargetM: number;
  verifiedHarvestedVolumeM3?: number;
  verifiedTreeCount?: number;
  discrepancies?: string;
  clientRef: string;
}

const INSPECTIONS: InspectionSpec[] = [
  {
    key: 'i1',
    reference: 'DEMO-INS-2026-0001',
    type: InspectionType.ROUTINE,
    status: InspectionStatus.CLOSED,
    outcome: InspectionOutcome.COMPLIANT,
    complianceScore: 92,
    title: 'Contrôle de routine — Bloc A, Djoum',
    summary:
      'Exploitation conforme au marquage : volumes déclarés vérifiés sur 12 piles, bandes riveraines respectées, registre de coupe tenu à jour.',
    recommendations: 'Poursuivre la campagne et transmettre le registre mensuel avant le 5 du mois.',
    forestKey: 'djoum',
    zoneKey: 'dj-a',
    companyKey: 'smds',
    permitKey: 'p1',
    activityKey: 'a1',
    inspector: 'inspector',
    scheduledDays: -200,
    startedDays: -199,
    completedDays: -198,
    submittedDays: -197,
    reviewedDays: -195,
    latitude: 2.7963,
    longitude: 12.8467,
    accuracyM: 4.8,
    gpsCapturedDays: -199,
    distanceFromTargetM: 38,
    verifiedHarvestedVolumeM3: 1_140,
    verifiedTreeCount: 266,
    clientRef: 'demo-ins-0001',
  },
  {
    key: 'i2',
    reference: 'DEMO-INS-2026-0002',
    type: InspectionType.COMPLIANCE,
    status: InspectionStatus.CLOSED,
    outcome: InspectionOutcome.MINOR_NON_COMPLIANCE,
    complianceScore: 74,
    title: 'Inspection de conformité — UFA 10-008, assiette Sud',
    summary:
      'Quotas respectés par essence, mais deux pistes de débardage non refermées et un défaut de signalisation des limites de l’assiette.',
    recommendations: 'Fermer les layons sous 30 jours et remettre en peinture les bornes de limite de l’assiette.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    companyKey: 'efe',
    permitKey: 'p3',
    activityKey: 'a6',
    inspector: 'inspector',
    scheduledDays: -120,
    startedDays: -119,
    completedDays: -117,
    submittedDays: -116,
    reviewedDays: -114,
    latitude: 3.4921,
    longitude: 14.7651,
    accuracyM: 5.6,
    gpsCapturedDays: -119,
    distanceFromTargetM: 62,
    verifiedHarvestedVolumeM3: 3_370,
    verifiedTreeCount: 738,
    discrepancies: 'Écart de 18 m³ entre le registre interne et les piles mesurées, en faveur du registre officiel.',
    clientRef: 'demo-ins-0002',
  },
  {
    key: 'i3',
    reference: 'DEMO-INS-2026-0003',
    type: InspectionType.INCIDENT,
    status: InspectionStatus.SUBMITTED,
    outcome: InspectionOutcome.MAJOR_NON_COMPLIANCE,
    complianceScore: 48,
    title: 'Inspection d’incident — piste ouverte en bordure de cours d’eau',
    summary:
      'Une piste a été ouverte à environ 22 m du cours d’eau, en deçà de la bande de 30 m imposée par le cahier des charges. Les travaux ont été arrêtés sur place.',
    recommendations:
      'Rétablir la bande riveraine, réorienter le tracé et présenter un plan de réhabilitation avant toute reprise des travaux.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-b',
    companyKey: 'efe',
    permitKey: 'p9',
    activityKey: 'a8',
    inspector: 'inspector',
    scheduledDays: -52,
    startedDays: -51,
    completedDays: -50,
    submittedDays: -48,
    latitude: 3.5136,
    longitude: 14.7879,
    accuracyM: 6.3,
    gpsCapturedDays: -51,
    distanceFromTargetM: 24,
    discrepancies: 'Emprise de la piste mesurée à 22 m du cours d’eau (minimum réglementaire : 30 m).',
    clientRef: 'demo-ins-0003',
  },
  {
    key: 'i4',
    reference: 'DEMO-INS-2026-0004',
    type: InspectionType.ENVIRONMENTAL,
    status: InspectionStatus.CLOSED,
    outcome: InspectionOutcome.COMPLIANT,
    complianceScore: 88,
    title: 'Suivi environnemental — forêt communautaire de Mindourou',
    summary:
      'La zone sacrée est balisée et respectée ; aucun dépôt de déchets ni hydrocarbure constaté sur le chantier communautaire.',
    recommendations: 'Maintenir le balisage et former deux membres supplémentaires à la tenue du registre.',
    forestKey: 'mindourou',
    zoneKey: 'md-a',
    protectedAreaKey: undefined,
    companyKey: 'cofcom',
    permitKey: 'p4',
    activityKey: 'a11',
    inspector: 'environment',
    scheduledDays: -100,
    startedDays: -99,
    completedDays: -98,
    submittedDays: -97,
    reviewedDays: -95,
    latitude: 3.5015,
    longitude: 13.8821,
    accuracyM: 7.1,
    gpsCapturedDays: -99,
    distanceFromTargetM: 44,
    verifiedHarvestedVolumeM3: 758,
    verifiedTreeCount: 192,
    clientRef: 'demo-ins-0004',
  },
  {
    key: 'i5',
    reference: 'DEMO-INS-2026-0005',
    type: InspectionType.POST_ACTIVITY,
    status: InspectionStatus.REVIEWED,
    outcome: InspectionOutcome.MINOR_NON_COMPLIANCE,
    complianceScore: 69,
    title: 'Contrôle après exploitation — parcelle pilote 12, Mbalmayo',
    summary:
      'Site globalement propre, mais les obligations de replantation de la parcelle ne sont pas encore documentées.',
    recommendations: 'Déposer le plan de replantation des 12 ha ouverts et confirmer la provenance des plants.',
    forestKey: 'mbalmayo',
    zoneKey: 'mb-a',
    companyKey: 'bsc',
    permitKey: 'p5',
    activityKey: 'a16',
    inspector: 'inspector',
    scheduledDays: -35,
    startedDays: -34,
    completedDays: -33,
    submittedDays: -31,
    reviewedDays: -29,
    latitude: 3.5344,
    longitude: 11.5041,
    accuracyM: 5.4,
    gpsCapturedDays: -34,
    distanceFromTargetM: 51,
    discrepancies: 'Aucun document de replantation présenté alors que 12 ha ont été ouverts.',
    clientRef: 'demo-ins-0005',
  },
  {
    key: 'i6',
    reference: 'DEMO-INS-2026-0006',
    type: InspectionType.VERIFICATION,
    status: InspectionStatus.IN_PROGRESS,
    title: 'Vérification des volumes déclarés — Bloc A, Djoum',
    summary:
      'Vérification contradictoire des cubages de la bande 3 en cours, avec mesure de 40 arbres abattus et contrôle des bordereaux de transport.',
    recommendations: 'Poursuivre le mesurage et réconcilier les bordereaux avec le registre de coupe.',
    forestKey: 'djoum',
    zoneKey: 'dj-a',
    companyKey: 'smds',
    permitKey: 'p1',
    activityKey: 'a2',
    inspector: 'inspector',
    scheduledDays: -3,
    startedDays: -2,
    latitude: 2.8023,
    longitude: 12.8531,
    accuracyM: 4.6,
    gpsCapturedDays: -2,
    distanceFromTargetM: 19,
    clientRef: 'demo-ins-0006',
  },
  {
    key: 'i7',
    reference: 'DEMO-INS-2026-0007',
    type: InspectionType.ENVIRONMENTAL,
    status: InspectionStatus.SCHEDULED,
    title: 'Surveillance de la zone périphérique — Parc National de Korup',
    summary:
      'Mission programmée de contrôle de l’empiètement agricole et du respect de la zone tampon avec les comités paysans-forêts.',
    recommendations: 'Prévoir un accompagnement cartographique et deux écogardes pour la mission.',
    forestKey: 'korup-buffer',
    zoneKey: 'kb-a',
    protectedAreaKey: 'korup',
    inspector: 'environment',
    scheduledDays: 9,
    latitude: 5.0342,
    longitude: 8.8661,
    accuracyM: 8.9,
    gpsCapturedDays: -1,
    distanceFromTargetM: 0,
    clientRef: 'demo-ins-0007',
  },
  {
    key: 'i8',
    reference: 'DEMO-INS-2026-0008',
    type: InspectionType.COMPLIANCE,
    status: InspectionStatus.SCHEDULED,
    title: 'Contrôle de conformité — usine de transformation de Bassa',
    summary:
      'Contrôle documentaire et matériel de l’unité de transformation : traçabilité des grumes entrantes et taux de rendement matière.',
    recommendations: 'Préparer les registres d’entrée de grumes des six derniers mois.',
    forestKey: 'bidou',
    companyKey: 'cwpi',
    permitKey: 'p12',
    inspector: 'officer',
    scheduledDays: 16,
    latitude: 4.0513,
    longitude: 9.7682,
    accuracyM: 12.4,
    gpsCapturedDays: -1,
    distanceFromTargetM: 0,
    clientRef: 'demo-ins-0008',
  },
  {
    key: 'i9',
    reference: 'DEMO-INS-2026-0009',
    type: InspectionType.ROUTINE,
    status: InspectionStatus.CANCELLED,
    title: 'Contrôle de routine — plantation de Bafut-Ngemba',
    summary: 'Mission annulée : route d’accès coupée par les pluies ; une nouvelle date sera programmée.',
    recommendations: 'Reprogrammer la mission dès la réouverture de la piste.',
    forestKey: 'bafut',
    zoneKey: 'bf-a',
    companyKey: 'cwpi',
    inspector: 'inspector',
    scheduledDays: -12,
    latitude: 6.0953,
    longitude: 10.1047,
    accuracyM: 9.3,
    gpsCapturedDays: -13,
    distanceFromTargetM: 0,
    clientRef: 'demo-ins-0009',
  },
];

interface ViolationSpec {
  key: string;
  reference: string;
  title: string;
  description: string;
  severity: ViolationSeverity;
  status: ViolationStatus;
  forestKey: string;
  zoneKey?: string;
  protectedAreaKey?: string;
  companyKey?: string;
  permitKey?: string;
  activityKey?: string;
  inspectionKey?: string;
  latitude: number;
  longitude: number;
  detectedDays: number;
  estimatedDamageXAF: number;
  penaltyAmountXAF: number;
  remediationRequired: boolean;
  remediationDays?: number;
  remediationNotes?: string;
  investigationNotes: string;
  resolvedDays?: number;
  resolutionSummary?: string;
}

const VIOLATIONS: ViolationSpec[] = [
  {
    key: 'v1',
    reference: 'DEMO-VIO-2026-0001',
    title: 'Emprise de culture dans la zone tampon du Parc National de Korup',
    description:
      'Trois parcelles de manioc et de plantain ont été défrichées à l’intérieur de la zone tampon, sur environ 1,4 ha, à proximité du village d’Ekonjo.',
    severity: ViolationSeverity.HIGH,
    status: ViolationStatus.UNDER_INVESTIGATION,
    forestKey: 'korup-buffer',
    zoneKey: 'kb-a',
    protectedAreaKey: 'korup',
    latitude: 5.0402,
    longitude: 8.8714,
    detectedDays: -34,
    estimatedDamageXAF: 2_800_000,
    penaltyAmountXAF: 0,
    remediationRequired: true,
    remediationDays: 30,
    investigationNotes:
      'Délimitation contradictoire en cours avec le comité paysan-forêt. Aucune entreprise forestière n’est mise en cause à ce stade.',
  },
  {
    key: 'v2',
    reference: 'DEMO-VIO-2026-0002',
    title: 'Piste ouverte à moins de 30 m d’un cours d’eau (UFA 10-008)',
    description:
      'Lors de l’inspection DEMO-INS-2026-0003, une piste d’accès a été mesurée à 22 m de la rive du cours d’eau, en deçà de la bande riveraine de 30 m.',
    severity: ViolationSeverity.HIGH,
    status: ViolationStatus.CONFIRMED,
    forestKey: 'yokadouma',
    zoneKey: 'yk-b',
    companyKey: 'efe',
    permitKey: 'p9',
    activityKey: 'a8',
    inspectionKey: 'i3',
    latitude: 3.5137,
    longitude: 14.788,
    detectedDays: -50,
    estimatedDamageXAF: 5_200_000,
    penaltyAmountXAF: 4_500_000,
    remediationRequired: true,
    remediationDays: 30,
    investigationNotes:
      'Responsabilité de l’entreprise établie par procès-verbal contradictoire signé sur site le jour du constat. Réhabilitation en cours.',
  },
  {
    key: 'v3',
    reference: 'DEMO-VIO-2026-0003',
    title: 'Dépôt d’hydrocarbures non confiné sur une aire de sciage',
    description:
      'Constat d’un fût d’huile hydraulique percé et d’un sol imprégné sur environ 40 m², sans bâche ni kit anti-pollution à proximité.',
    severity: ViolationSeverity.MEDIUM,
    status: ViolationStatus.RESOLVED,
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    companyKey: 'efe',
    permitKey: 'p3',
    latitude: 3.4889,
    longitude: 14.7583,
    detectedDays: -70,
    estimatedDamageXAF: 1_100_000,
    penaltyAmountXAF: 4_500_000,
    remediationRequired: true,
    remediationDays: 60,
    remediationNotes:
      'Sol excavé et évacué vers le centre agréé de Bertoua ; zone recouverte de terre végétale ; kit anti-pollution installé et deux employés formés.',
    investigationNotes: 'Amende réglée par virement bancaire (DEMO-PAY-2026-0011) et travaux de dépollution réceptionnés.',
    resolvedDays: -20,
    resolutionSummary:
      'Dépollution réceptionnée par procès-verbal du 4 septembre 2026 et amende intégralement recouvrée.',
  },
  {
    key: 'v4',
    reference: 'DEMO-VIO-2026-0004',
    title: 'Signalement de sciage non déclaré en lisière de la forêt de Bidou I',
    description:
      'Signalement d’un sciage mobile sans déclaration à proximité de la route Kribi–Lolabé. Aucun titulaire de permis n’a été identifié sur place.',
    severity: ViolationSeverity.HIGH,
    status: ViolationStatus.OPEN,
    forestKey: 'bidou',
    zoneKey: 'bd-a',
    latitude: 2.9641,
    longitude: 9.9256,
    detectedDays: -12,
    estimatedDamageXAF: 3_400_000,
    penaltyAmountXAF: 0,
    remediationRequired: true,
    remediationDays: 30,
    investigationNotes:
      'Patrouille conjointe à programmer avec la délégation du Sud. Aucune personne ni entreprise n’est désignée tant que l’instruction n’est pas terminée.',
  },
  {
    key: 'v5',
    reference: 'DEMO-VIO-2026-0005',
    title: 'Layons de débardage non refermés après exploitation',
    description:
      'Deux layons de débardage sont restés ouverts plus de 30 jours après la fin de la campagne, contrairement au cahier des charges du permis.',
    severity: ViolationSeverity.LOW,
    status: ViolationStatus.RESOLVED,
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    companyKey: 'efe',
    permitKey: 'p3',
    activityKey: 'a6',
    inspectionKey: 'i2',
    latitude: 3.4933,
    longitude: 14.7659,
    detectedDays: -110,
    estimatedDamageXAF: 450_000,
    penaltyAmountXAF: 0,
    remediationRequired: true,
    remediationDays: 30,
    remediationNotes: 'Layons refermés et barrières de bois installées ; constat contradictoire du 12 août 2026.',
    investigationNotes:
      'Manquement reconnu par l’entreprise ; aucun impact hydrologique persistant constaté lors du contrôle de clôture.',
    resolvedDays: -40,
    resolutionSummary: 'Travaux de fermeture réceptionnés sans réserve ; dossier clos sans amende au vu des délais de bonne foi.',
  },
  {
    key: 'v6',
    reference: 'DEMO-VIO-2026-0006',
    title: 'Absence de registre de coupe sur un chantier communautaire',
    description:
      'Le registre de coupe n’a pas pu être présenté lors du contrôle de la forêt communautaire de Mindourou ; les volumes n’étaient donc pas vérifiables.',
    severity: ViolationSeverity.MEDIUM,
    status: ViolationStatus.ESCALATED,
    forestKey: 'mindourou',
    zoneKey: 'md-a',
    companyKey: 'cofcom',
    permitKey: 'p4',
    activityKey: 'a11',
    inspectionKey: 'i4',
    latitude: 3.5017,
    longitude: 13.8823,
    detectedDays: -96,
    estimatedDamageXAF: 0,
    penaltyAmountXAF: 750_000,
    remediationRequired: true,
    remediationDays: 60,
    investigationNotes:
      'Dossier transmis à la commission départementale : la coopérative invoque une panne informatique, le registre manuscrit est en cours de reconstitution.',
  },
  {
    key: 'v7',
    reference: 'DEMO-VIO-2026-0007',
    title: 'Cubage déclaré supérieur au prévisionnel de la bande 3',
    description:
      'Le volume déclaré pour la bande 3 dépasse de 321 m³ le prévisionnel de l’assiette. Il peut s’agir d’une erreur de cubage ou d’une coupe hors assiette : un mesurage contradictoire est en cours.',
    severity: ViolationSeverity.HIGH,
    status: ViolationStatus.OPEN,
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    companyKey: 'efe',
    permitKey: 'p3',
    activityKey: 'a7',
    latitude: 3.4864,
    longitude: 14.7571,
    detectedDays: -9,
    estimatedDamageXAF: 0,
    penaltyAmountXAF: 0,
    remediationRequired: false,
    investigationNotes:
      'Aucune conclusion sur la responsabilité : la vérification contradictoire DEMO-INS-2026-0006 doit établir si l’écart provient du cubage ou d’un dépassement d’assiette.',
  },
];

interface ObservationSpec {
  key: string;
  category: ObservationCategory;
  severity: ViolationSeverity;
  title: string;
  description: string;
  forestKey: string;
  zoneKey?: string;
  protectedAreaKey?: string;
  activityKey?: string;
  inspectionKey?: string;
  latitude: number;
  longitude: number;
  capturedDays: number;
  accuracyM: number;
  observer: 'inspector' | 'environment' | 'operator' | 'explorer';
  syncStatus: SyncStatus;
  clientRef: string;
}

const OBSERVATIONS: ObservationSpec[] = [
  {
    key: 'o1',
    category: ObservationCategory.ILLEGAL_LOGGING,
    severity: ViolationSeverity.HIGH,
    title: 'Souche fraîche hors zone d’assiette',
    description:
      'Souche d’un arbre abattu hors du périmètre marqué, à environ 320 m à l’est de la limite de l’assiette. Position relevée avec le GPS du téléphone.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    activityKey: 'a7',
    latitude: 3.4879,
    longitude: 14.7602,
    capturedDays: -9,
    accuracyM: 6.8,
    observer: 'inspector',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0001',
  },
  {
    key: 'o2',
    category: ObservationCategory.WATER_BODY,
    severity: ViolationSeverity.HIGH,
    title: 'Cours d’eau traversé par une piste',
    description:
      'Piste forestière traversant un petit cours d’eau sans ouvrage de franchissement ni bande riveraine conservée.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-b',
    activityKey: 'a8',
    inspectionKey: 'i3',
    latitude: 3.5138,
    longitude: 14.7882,
    capturedDays: -51,
    accuracyM: 5.9,
    observer: 'inspector',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0002',
  },
  {
    key: 'o3',
    category: ObservationCategory.WILDLIFE,
    severity: ViolationSeverity.LOW,
    title: 'Traces d’éléphants de forêt près des salines',
    description:
      'Empreintes et écorçages récents observés sur trois arbres autour d’une saline ; aucun signe de braconnage.',
    forestKey: 'djoum',
    zoneKey: 'dj-c',
    latitude: 2.7412,
    longitude: 12.8689,
    capturedDays: -46,
    accuracyM: 8.4,
    observer: 'explorer',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0003',
  },
  {
    key: 'o4',
    category: ObservationCategory.TREE_CONDITION,
    severity: ViolationSeverity.MEDIUM,
    title: 'Chablis important après vents forts',
    description:
      'Neuf arbres de plus de 80 cm renversés dans la bande 2 après une tempête ; bois encore exploitable en récupération.',
    forestKey: 'bidou',
    zoneKey: 'bd-a',
    activityKey: 'a14',
    latitude: 2.9548,
    longitude: 9.9137,
    capturedDays: -181,
    accuracyM: 7.6,
    observer: 'operator',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0004',
  },
  {
    key: 'o5',
    category: ObservationCategory.SOIL,
    severity: ViolationSeverity.MEDIUM,
    title: 'Érosion active sur une piste de débardage',
    description:
      'Rigoles de 40 cm constatées sur 180 m de piste, avec un début d’entraînement de sédiments vers un bas-fond.',
    forestKey: 'mbalmayo',
    zoneKey: 'mb-a',
    activityKey: 'a16',
    latitude: 3.5361,
    longitude: 11.5067,
    capturedDays: -33,
    accuracyM: 6.2,
    observer: 'inspector',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0005',
  },
  {
    key: 'o6',
    category: ObservationCategory.ENCROACHMENT,
    severity: ViolationSeverity.HIGH,
    title: 'Champ de manioc dans la zone tampon',
    description:
      'Parcelle agricole récente empiétant sur la zone tampon du parc ; limites villageoises en cours de vérification.',
    forestKey: 'korup-buffer',
    zoneKey: 'kb-a',
    protectedAreaKey: 'korup',
    latitude: 5.0404,
    longitude: 8.8716,
    capturedDays: -35,
    accuracyM: 9.8,
    observer: 'environment',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0006',
  },
  {
    key: 'o7',
    category: ObservationCategory.VEGETATION_COVER,
    severity: ViolationSeverity.LOW,
    title: 'Reprise de la régénération sur le bloc Est',
    description:
      'Reprise visible des semis de sapelli et de fraké sur les anciennes pistes fermées ; densité estimée à 1 400 tiges/ha.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-b',
    latitude: 3.5219,
    longitude: 14.7904,
    capturedDays: -26,
    accuracyM: 7.9,
    observer: 'explorer',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0007',
  },
  {
    key: 'o8',
    category: ObservationCategory.FIRE_DAMAGE,
    severity: ViolationSeverity.MEDIUM,
    title: 'Feu de brousse ayant atteint la lisière de la plantation',
    description:
      'Feu de brousse tardif ayant brûlé environ 3 ha de lisière ; aucune perte majeure sur les parcelles en production.',
    forestKey: 'bafut',
    zoneKey: 'bf-b',
    latitude: 6.0812,
    longitude: 10.0889,
    capturedDays: -64,
    accuracyM: 10.1,
    observer: 'operator',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0008',
  },
  {
    key: 'o9',
    category: ObservationCategory.INFRASTRUCTURE,
    severity: ViolationSeverity.LOW,
    title: 'Pont de rondins endommagé',
    description:
      'Deux rondins cassés sur le franchissement d’un bas-fond ; passage encore possible pour les véhicules légers seulement.',
    forestKey: 'mindourou',
    zoneKey: 'md-a',
    activityKey: 'a12',
    latitude: 3.4951,
    longitude: 13.8718,
    capturedDays: -11,
    accuracyM: 5.7,
    observer: 'operator',
    syncStatus: SyncStatus.PENDING_SYNC,
    clientRef: 'demo-obs-0009',
  },
  {
    key: 'o10',
    category: ObservationCategory.WEATHER,
    severity: ViolationSeverity.LOW,
    title: 'Pluies continues ayant interrompu l’abattage',
    description:
      'Trois jours de pluies fortes ; abattage suspendu par sécurité et pistes temporairement impraticables.',
    forestKey: 'djoum',
    zoneKey: 'dj-a',
    activityKey: 'a2',
    latitude: 2.8026,
    longitude: 12.8536,
    capturedDays: -6,
    accuracyM: 8.6,
    observer: 'operator',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0010',
  },
  {
    key: 'o11',
    category: ObservationCategory.INCIDENT,
    severity: ViolationSeverity.MEDIUM,
    title: 'Fût d’huile hydraulique percé',
    description:
      'Fût percé constaté sur l’aire de sciage, avec sol imprégné sur environ 40 m² ; zone balisée sur place.',
    forestKey: 'yokadouma',
    zoneKey: 'yk-a',
    latitude: 3.4888,
    longitude: 14.7585,
    inspectionKey: 'i2',
    capturedDays: -71,
    accuracyM: 6.5,
    observer: 'environment',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0011',
  },
  {
    key: 'o12',
    category: ObservationCategory.OTHER,
    severity: ViolationSeverity.LOW,
    title: 'Rencontre de sensibilisation avec le comité paysan-forêt',
    description:
      'Réunion de sensibilisation sur le balisage de la zone tampon et les procédures de signalement, 24 participants.',
    forestKey: 'korup-buffer',
    zoneKey: 'kb-a',
    protectedAreaKey: 'korup',
    latitude: 5.0334,
    longitude: 8.8652,
    capturedDays: -22,
    accuracyM: 11.7,
    observer: 'environment',
    syncStatus: SyncStatus.SYNCED,
    clientRef: 'demo-obs-0012',
  },
];

interface EquipmentSpec {
  key: string;
  companyKey: string;
  name: string;
  category: EquipmentCategory;
  status: EquipmentStatus;
  registrationNumber: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  capacityM3: number | null;
  acquiredDays: number;
  lastMaintenanceDays: number;
  nextMaintenanceDays: number;
  notes: string;
}

const EQUIPMENT: EquipmentSpec[] = [
  {
    key: 'eq1',
    companyKey: 'smds',
    name: 'Abatteuse Ponsse Scorpion',
    category: EquipmentCategory.HARVESTER,
    status: EquipmentStatus.IN_USE,
    registrationNumber: 'LT-4821-BTA',
    serialNumber: 'PON-SC-2019-4821',
    manufacturer: 'Ponsse',
    model: 'Scorpion King',
    capacityM3: 42,
    acquiredDays: -1_100,
    lastMaintenanceDays: -48,
    nextMaintenanceDays: 42,
    notes: 'Entretien hydraulique réalisé à 6 200 heures ; prochaine révision à 6 500 heures.',
  },
  {
    key: 'eq2',
    companyKey: 'smds',
    name: 'Tronçonneuse Stihl MS 881',
    category: EquipmentCategory.CHAINSAW,
    status: EquipmentStatus.IN_USE,
    registrationNumber: 'CH-1187-BTA',
    serialNumber: 'STL-881-2023-1187',
    manufacturer: 'Stihl',
    model: 'MS 881',
    capacityM3: null,
    acquiredDays: -560,
    lastMaintenanceDays: -21,
    nextMaintenanceDays: 9,
    notes: 'Chaîne remplacée et graissage vérifié.',
  },
  {
    key: 'eq3',
    companyKey: 'smds',
    name: 'Camion grumier Mercedes Actros',
    category: EquipmentCategory.LOGGING_TRUCK,
    status: EquipmentStatus.AVAILABLE,
    registrationNumber: 'CE-7742-BTA',
    serialNumber: 'MB-ACT-2020-7742',
    manufacturer: 'Mercedes-Benz',
    model: 'Actros 3344',
    capacityM3: 38,
    acquiredDays: -1_320,
    lastMaintenanceDays: -30,
    nextMaintenanceDays: 60,
    notes: 'Pont-bascule intégré étalonné le mois dernier.',
  },
  {
    key: 'eq4',
    companyKey: 'smds',
    name: 'Débusqueuse Caterpillar 525C',
    category: EquipmentCategory.SKIDDER,
    status: EquipmentStatus.MAINTENANCE,
    registrationNumber: 'SK-2255-BTA',
    serialNumber: 'CAT-525-2018-2255',
    manufacturer: 'Caterpillar',
    model: '525C',
    capacityM3: 20,
    acquiredDays: -1_500,
    lastMaintenanceDays: -5,
    nextMaintenanceDays: 55,
    notes: 'Remplacement d’un vérin de lame en cours à l’atelier de Bertoua.',
  },
  {
    key: 'eq5',
    companyKey: 'efe',
    name: 'Porteur Timberjack 1110',
    category: EquipmentCategory.LOG_LOADER,
    status: EquipmentStatus.IN_USE,
    registrationNumber: 'PR-9080-YKM',
    serialNumber: 'TJ-1110-2017-9080',
    manufacturer: 'Timberjack',
    model: '1110',
    capacityM3: 26,
    acquiredDays: -1_900,
    lastMaintenanceDays: -60,
    nextMaintenanceDays: 30,
    notes: 'Affecté à la bande 3 de l’UFA 10-008.',
  },
  {
    key: 'eq6',
    companyKey: 'efe',
    name: 'Bulldozer Komatsu D65',
    category: EquipmentCategory.BULLDOZER,
    status: EquipmentStatus.OUT_OF_SERVICE,
    registrationNumber: 'BZ-3391-YKM',
    serialNumber: 'KOM-D65-2015-3391',
    manufacturer: 'Komatsu',
    model: 'D65EX-16',
    capacityM3: null,
    acquiredDays: -2_400,
    lastMaintenanceDays: -95,
    nextMaintenanceDays: -5,
    notes: 'Immobilisé après surchauffe sur le chantier de la piste ; expertise demandée.',
  },
  {
    key: 'eq7',
    companyKey: 'efe',
    name: 'Drone de cartographie DJI Matrice 350',
    category: EquipmentCategory.DRONE,
    status: EquipmentStatus.AVAILABLE,
    registrationNumber: 'DR-5520-YKM',
    serialNumber: 'DJI-M350-2024-5520',
    manufacturer: 'DJI',
    model: 'Matrice 350 RTK',
    capacityM3: null,
    acquiredDays: -420,
    lastMaintenanceDays: -15,
    nextMaintenanceDays: 90,
    notes: 'Missions photogrammétriques pour la cartographie des assiettes annuelles.',
  },
  {
    key: 'eq8',
    companyKey: 'cofcom',
    name: 'Tracteur avec remorque forestière',
    category: EquipmentCategory.TRACTOR,
    status: EquipmentStatus.IN_USE,
    registrationNumber: 'TR-6612-MDR',
    serialNumber: 'MF-440-2019-6612',
    manufacturer: 'Massey Ferguson',
    model: 'MF 440',
    capacityM3: 12,
    acquiredDays: -1_050,
    lastMaintenanceDays: -25,
    nextMaintenanceDays: 35,
    notes: 'Matériel de la coopérative, partagé entre les membres du bloc Nord.',
  },
  {
    key: 'eq9',
    companyKey: 'cwpi',
    name: 'Scie à ruban industrielle Bongioanni',
    category: EquipmentCategory.OTHER,
    status: EquipmentStatus.IN_USE,
    registrationNumber: 'SC-2210-DLA',
    serialNumber: 'BGN-2021-2210',
    manufacturer: 'Bongioanni',
    model: 'Linea 2100',
    capacityM3: 18,
    acquiredDays: -1_700,
    lastMaintenanceDays: -40,
    nextMaintenanceDays: 20,
    notes: 'Rendement matière suivi mensuellement par le bureau d’études.',
  },
  {
    key: 'eq10',
    companyKey: 'cwpi',
    name: 'Lot de GPS de terrain Garmin 66sr',
    category: EquipmentCategory.SURVEY_EQUIPMENT,
    status: EquipmentStatus.AVAILABLE,
    registrationNumber: 'GPS-8890-DLA',
    serialNumber: 'GRM-66SR-2023-8890',
    manufacturer: 'Garmin',
    model: 'GPSMAP 66sr',
    capacityM3: null,
    acquiredDays: -380,
    lastMaintenanceDays: -60,
    nextMaintenanceDays: 30,
    notes: 'Douze unités étalonnées, précision annoncée de 3 m en forêt.',
  },
];

// ---------------------------------------------------------------------------
// seeding steps
// ---------------------------------------------------------------------------

/**
 * Who created a record on behalf of a company: that company's own account when
 * one exists, otherwise the forest officer who entered the historical record.
 * Never another company's account — scope filters key on the creator.
 */
const COMPANY_ACCOUNTS: Record<string, string> = {
  smds: 'company',
  cofcom: 'company2',
  efe: 'company3',
  bsc: 'company4',
  cwpi: 'company5',
};

function actorForCompany(userIds: Map<string, string>, companyKey: string | undefined): string {
  const userKey = companyKey ? COMPANY_ACCOUNTS[companyKey] : undefined;
  return (userKey ? userIds.get(userKey) : undefined) ?? (userIds.get('officer') as string);
}

async function seedUsers(roleIds: Map<string, string>): Promise<Map<string, string>> {
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const ids = new Map<string, string>();

  for (const spec of USERS) {
    const id = `demo-user-${spec.key}`;
    const roleId = roleIds.get(spec.role);
    if (!roleId) throw new Error(`Unknown role ${spec.role} for demo user ${spec.email}`);

    await put('user', prisma.user, id, {
      email: spec.email,
      passwordHash,
      firstName: spec.firstName,
      lastName: spec.lastName,
      phone: spec.phone,
      jobTitle: spec.jobTitle,
      status: UserStatus.ACTIVE,
      isDemo: true,
      emailVerifiedAt: daysFromNow(-400),
      preferredLanguage: spec.preferredLanguage,
      companyId: null,
    });
    await putComposite(
      'user role',
      prisma.userRole,
      { userId_roleId: { userId: id, roleId } },
      { userId: id, roleId, assignedAt: daysFromNow(-400) },
    );
    ids.set(spec.key, id);
  }

  return ids;
}

async function seedCompanies(userIds: Map<string, string>): Promise<void> {
  for (const spec of COMPANIES) {
    const verifiedDays = spec.status === CompanyStatus.VERIFIED ? -390 : undefined;
    await put('company', prisma.company, `demo-co-${spec.key}`, {
      name: spec.name,
      registrationNumber: spec.registrationNumber,
      taxNumber: spec.taxNumber,
      type: spec.type,
      status: spec.status,
      email: spec.email,
      phone: spec.phone,
      alternatePhone: '+237 222 21 40 88',
      addressLine: spec.addressLine,
      city: spec.city,
      region: spec.region,
      country: 'Cameroun',
      website: `https://${spec.email.split('@')[1]}`,
      latitude: spec.latitude,
      longitude: spec.longitude,
      employeeCount: spec.employeeCount,
      description: `${spec.description} (jeu de données de démonstration FEMS)`,
      ownerId: null,
      verifiedAt: verifiedDays === undefined ? null : daysFromNow(verifiedDays),
      verifiedById: verifiedDays === undefined ? null : userIds.get('admin'),
      isDemo: true,
    });
  }

  // Administrative documents: the second company deliberately has an expired
  // compliance certificate so the "document anomaly" rules have something real
  // to look at.
  const documents: Array<{
    key: string;
    companyKey: string;
    type: DocumentType;
    title: string;
    expiresDays?: number;
    isVerified: boolean;
    notes: string;
  }> = [
    {
      key: 'd1',
      companyKey: 'smds',
      type: DocumentType.COMPANY_REGISTRATION,
      title: 'Registre de commerce — Scierie Moderne du Dja SA',
      isVerified: true,
      notes: 'Copie certifiée déposée au dossier administratif.',
    },
    {
      key: 'd2',
      companyKey: 'smds',
      type: DocumentType.TAX_CLEARANCE,
      title: 'Attestation de conformité fiscale 2026',
      expiresDays: 210,
      isVerified: true,
      notes: 'Attestation valable jusqu’à la fin de l’exercice fiscal en cours.',
    },
    {
      key: 'd3',
      companyKey: 'smds',
      type: DocumentType.MANAGEMENT_PLAN,
      title: 'Plan d’aménagement de la forêt de Djoum (2024-2029)',
      expiresDays: 1_120,
      isVerified: true,
      notes: 'Plan approuvé par arrêté ministériel.',
    },
    {
      key: 'd4',
      companyKey: 'efe',
      type: DocumentType.EXPLOITATION_LICENCE,
      title: "Autorisation d'exploitation — UFA 10-008",
      expiresDays: 330,
      isVerified: true,
      notes: 'Titre en cours de validité pour la campagne 2026.',
    },
    {
      key: 'd5',
      companyKey: 'efe',
      type: DocumentType.ENVIRONMENTAL_IMPACT_ASSESSMENT,
      title: 'Étude d’impact environnemental et social — campagne 2023',
      expiresDays: -120,
      isVerified: false,
      notes:
        'Étude expirée : l’actualisation est en attente auprès du bureau d’études. Document signalé au dossier, non renouvelé.',
    },
    {
      key: 'd6',
      companyKey: 'cofcom',
      type: DocumentType.MANAGEMENT_PLAN,
      title: 'Plan simple de gestion quinquennal — Mindourou',
      expiresDays: 640,
      isVerified: true,
      notes: 'PSG validé par la délégation départementale du Haut-Nyong.',
    },
    {
      key: 'd7',
      companyKey: 'cwpi',
      type: DocumentType.LAND_TITLE,
      title: 'Titre foncier — site industriel de Bassa',
      isVerified: true,
      notes: 'Titre foncier du site de transformation.',
    },
    {
      key: 'd8',
      companyKey: 'ntt',
      type: DocumentType.TAX_CLEARANCE,
      title: 'Attestation de conformité fiscale — Nkam Timber Traders',
      expiresDays: -15,
      isVerified: false,
      notes: 'Attestation expirée : à l’origine du rejet du permis DEMO-EXP-2026-0008.',
    },
  ];

  for (const doc of documents) {
    await put('company document', prisma.companyDocument, `demo-doc-${doc.key}`, {
      companyId: `demo-co-${doc.companyKey}`,
      type: doc.type,
      title: doc.title,
      fileUrl: `/files/demo/${doc.key}.pdf`,
      fileKey: `companies/documents/demo-${doc.key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 240_000 + documents.indexOf(doc) * 1_500,
      isVerified: doc.isVerified,
      verifiedById: doc.isVerified ? userIds.get('admin') : null,
      verifiedAt: doc.isVerified ? daysFromNow(-380) : null,
      expiresAt: doc.expiresDays === undefined ? null : daysFromNow(doc.expiresDays),
      notes: doc.notes,
      uploadedById: actorForCompany(userIds, doc.companyKey),
    });
  }
}

/** Company membership is a two-way link: apply it once both sides exist. */
async function linkCompaniesAndUsers(userIds: Map<string, string>): Promise<void> {
  for (const spec of USERS) {
    if (!spec.companyKey) continue;
    await prisma.user.update({
      where: { id: userIds.get(spec.key) as string },
      data: { companyId: `demo-co-${spec.companyKey}` },
    });
  }
  for (const spec of COMPANIES) {
    await prisma.company.update({
      where: { id: `demo-co-${spec.key}` },
      data: { ownerId: userIds.get('company') as string },
    });
  }
  tally('company membership link', USERS.filter((user) => user.companyKey).length + COMPANIES.length);
}

async function seedForests(userIds: Map<string, string>): Promise<void> {
  const protectedAreaIds = new Map<string, string>();
  for (const area of PROTECTED_AREAS) {
    const id = `demo-pa-${area.key}`;
    await put('protected area', prisma.protectedArea, id, {
      code: area.code,
      name: area.name,
      type: area.type,
      status: ProtectedAreaStatus.ACTIVE,
      region: area.region,
      areaHa: area.areaHa,
      latitude: area.latitude,
      longitude: area.longitude,
      establishedAt: new Date(`${area.established}T00:00:00Z`),
      managingAuthority: area.authority,
      description: area.description,
      biodiversityNotes: area.biodiversity,
      encroachmentRisk: area.encroachmentRisk,
      isDemo: true,
      createdById: userIds.get('admin') as string,
    });
    protectedAreaIds.set(area.key, id);
    await put('gis feature', prisma.gISLocation, `demo-gis-pa-${area.key}`, {
      featureType: 'PROTECTED_AREA',
      entityId: id,
      label: area.name,
      latitude: area.latitude,
      longitude: area.longitude,
      source: GpsSource.SEED_DEMO,
      protectedAreaId: id,
      recordedById: userIds.get('admin'),
      recordedAt: daysFromNow(-400),
      isDemo: true,
      metadataJson: JSON.stringify({ code: area.code, areaHa: area.areaHa, isDemo: true }),
    });
  }

  for (const forest of FORESTS) {
    const id = `demo-forest-${forest.key}`;
    await put('forest', prisma.forest, id, {
      code: forest.code,
      name: forest.name,
      description: forest.description,
      type: forest.type,
      status: forest.status,
      region: forest.region,
      division: forest.division,
      subdivision: forest.subdivision,
      totalAreaHa: forest.totalAreaHa,
      exploitableAreaHa: forest.exploitableAreaHa,
      latitude: forest.latitude,
      longitude: forest.longitude,
      elevationM: forest.elevationM,
      annualAllowableCutM3: forest.annualAllowableCutM3,
      establishedAt: new Date(`${forest.established}T00:00:00Z`),
      lastInventoriedAt: new Date(`${forest.lastInventoried}T00:00:00Z`),
      isPublic: true,
      isDemo: true,
      protectedAreaId: forest.protectedAreaKey ? protectedAreaIds.get(forest.protectedAreaKey) : null,
      managedById: userIds.get('officer'),
      createdById: userIds.get('admin') as string,
    });
    await put('gis feature', prisma.gISLocation, `demo-gis-forest-${forest.key}`, {
      featureType: 'FOREST',
      entityId: id,
      label: forest.name,
      latitude: forest.latitude,
      longitude: forest.longitude,
      elevationM: forest.elevationM,
      source: GpsSource.SEED_DEMO,
      forestId: id,
      recordedById: userIds.get('admin'),
      recordedAt: daysFromNow(-400),
      isDemo: true,
      metadataJson: JSON.stringify({ code: forest.code, region: forest.region, totalAreaHa: forest.totalAreaHa, isDemo: true }),
    });
  }

  for (const zone of ZONES) {
    const id = `demo-zone-${zone.key}`;
    const forestId = `demo-forest-${zone.forestKey}`;
    await put('forest zone', prisma.forestZone, id, {
      forestId,
      code: zone.code,
      name: zone.name,
      zoneType: zone.zoneType,
      status: zone.status,
      areaHa: zone.areaHa,
      latitude: zone.latitude,
      longitude: zone.longitude,
      maxAnnualYieldM3: zone.maxAnnualYieldM3,
      conservationPriority: zone.conservationPriority,
      isProtected: zone.isProtected,
      description: zone.description,
      lastHarvestedAt: zone.lastHarvestedDaysAgo === undefined ? null : daysFromNow(-zone.lastHarvestedDaysAgo),
      isDemo: true,
      createdById: userIds.get('officer') as string,
    });
    await put('gis feature', prisma.gISLocation, `demo-gis-zone-${zone.key}`, {
      featureType: 'FOREST_ZONE',
      entityId: id,
      label: `${zone.code} — ${zone.name}`,
      latitude: zone.latitude,
      longitude: zone.longitude,
      source: GpsSource.SEED_DEMO,
      forestId,
      zoneId: id,
      recordedById: userIds.get('officer'),
      recordedAt: daysFromNow(-400),
      isDemo: true,
      metadataJson: JSON.stringify({ zoneType: zone.zoneType, areaHa: zone.areaHa, isDemo: true }),
    });
  }
}

/**
 * Species are reference data: `scientificName` is the natural key, so an
 * existing catalogue row is completed rather than duplicated. Records that
 * already existed keep their own id and their `isDemo` flag.
 */
async function seedSpecies(userIds: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const species of SPECIES) {
    const fields = {
      scientificName: species.scientificName,
      commonName: species.commonName,
      familyName: species.familyName,
      localName: species.localName,
      iucnStatus: species.iucnStatus,
      isProtected: species.isProtected,
      isCommercial: species.isCommercial,
      maxHarvestDiameterCm: species.maxHarvestDiameterCm,
      minRotationYears: species.minRotationYears,
      woodDensityKgM3: species.woodDensityKgM3,
      description: species.description,
    };

    const existing = await prisma.treeSpecies.findUnique({
      where: { scientificName: species.scientificName },
      select: { id: true },
    });
    if (existing) {
      await prisma.treeSpecies.update({ where: { id: existing.id }, data: fields });
      ids.set(species.key, existing.id);
      tally('tree species (existing)');
      continue;
    }

    const id = `demo-species-${species.key}`;
    await put('tree species', prisma.treeSpecies, id, {
      ...fields,
      isDemo: true,
      createdById: userIds.get('admin') as string,
    });
    ids.set(species.key, id);
  }
  return ids;
}

/**
 * Natural keys (forest codes, permit numbers, references…) are unique in the
 * database. Rather than failing halfway through with a Prisma constraint error,
 * the seed checks them up front and stops with an explicit list when the target
 * database already holds non-demo records under the same keys.
 */
async function assertNoNaturalKeyConflicts(): Promise<string[]> {
  const notDemo = { NOT: { id: { startsWith: 'demo-' } } };
  const [areas, forests, companies, permits, inspections, violations, payments, activities, reports, users] =
    await Promise.all([
      prisma.protectedArea.findMany({ where: { code: { in: PROTECTED_AREAS.map((row) => row.code) }, ...notDemo }, select: { code: true } }),
      prisma.forest.findMany({ where: { code: { in: FORESTS.map((row) => row.code) }, ...notDemo }, select: { code: true } }),
      prisma.company.findMany({
        where: {
          OR: [
            { name: { in: COMPANIES.map((row) => row.name) } },
            { registrationNumber: { in: COMPANIES.map((row) => row.registrationNumber) } },
          ],
          ...notDemo,
        },
        select: { name: true },
      }),
      prisma.exploitationPermit.findMany({ where: { permitNumber: { in: PERMITS.map((row) => row.permitNumber) }, ...notDemo }, select: { permitNumber: true } }),
      prisma.inspection.findMany({ where: { reference: { in: INSPECTIONS.map((row) => row.reference) }, ...notDemo }, select: { reference: true } }),
      prisma.environmentalViolation.findMany({ where: { reference: { in: VIOLATIONS.map((row) => row.reference) }, ...notDemo }, select: { reference: true } }),
      prisma.payment.findMany({ where: { reference: { startsWith: 'DEMO-PAY-' }, ...notDemo }, select: { reference: true } }),
      prisma.exploitationActivity.findMany({ where: { reference: { startsWith: 'DEMO-ACT-' }, ...notDemo }, select: { reference: true } }),
      prisma.report.findMany({ where: { reference: { startsWith: 'DEMO-REP-' }, ...notDemo }, select: { reference: true } }),
      prisma.user.findMany({ where: { email: { in: USERS.map((row) => row.email) }, ...notDemo }, select: { email: true } }),
    ]);

  return [
    ...areas.map((row) => `protected area ${row.code}`),
    ...forests.map((row) => `forest ${row.code}`),
    ...companies.map((row) => `company ${row.name}`),
    ...permits.map((row) => `permit ${row.permitNumber}`),
    ...inspections.map((row) => `inspection ${row.reference}`),
    ...violations.map((row) => `violation ${row.reference}`),
    ...payments.map((row) => `payment ${row.reference}`),
    ...activities.map((row) => `activity ${row.reference}`),
    ...reports.map((row) => `report ${row.reference}`),
    ...users.map((row) => `user ${row.email}`),
  ];
}

async function seedInventories(userIds: Map<string, string>, speciesIds: Map<string, string>): Promise<void> {
  const random = makeRandom(20_260_924);
  const plan: Array<{ forest: string; zone: string; species: string; plot: string; count: number; diameterCm: number; heightM: number; health: TreeHealthStatus }> = [
    { forest: 'djoum', zone: 'dj-a', species: 'sapelli', plot: 'DJ-A-P01', count: 34, diameterCm: 96.4, heightM: 41.2, health: TreeHealthStatus.HEALTHY },
    { forest: 'djoum', zone: 'dj-a', species: 'iroko', plot: 'DJ-A-P02', count: 26, diameterCm: 88.7, heightM: 38.5, health: TreeHealthStatus.HEALTHY },
    { forest: 'djoum', zone: 'dj-a', species: 'ayous', plot: 'DJ-A-P03', count: 41, diameterCm: 74.2, heightM: 43.8, health: TreeHealthStatus.DAMAGED },
    { forest: 'djoum', zone: 'dj-b', species: 'azobe', plot: 'DJ-B-P04', count: 18, diameterCm: 82.1, heightM: 36.4, health: TreeHealthStatus.HEALTHY },
    { forest: 'djoum', zone: 'dj-c', species: 'moabi', plot: 'DJ-C-P05', count: 11, diameterCm: 104.6, heightM: 46.1, health: TreeHealthStatus.HEALTHY },
    { forest: 'mbalmayo', zone: 'mb-a', species: 'sapelli', plot: 'MB-A-P01', count: 22, diameterCm: 84.3, heightM: 37.9, health: TreeHealthStatus.HEALTHY },
    { forest: 'mbalmayo', zone: 'mb-a', species: 'frake', plot: 'MB-A-P02', count: 47, diameterCm: 68.9, heightM: 35.2, health: TreeHealthStatus.DISEASED },
    { forest: 'mbalmayo', zone: 'mb-b', species: 'tali', plot: 'MB-B-P03', count: 19, diameterCm: 76.4, heightM: 33.7, health: TreeHealthStatus.HEALTHY },
    { forest: 'mindourou', zone: 'md-a', species: 'ayous', plot: 'MD-A-P01', count: 52, diameterCm: 71.8, heightM: 42.6, health: TreeHealthStatus.HEALTHY },
    { forest: 'mindourou', zone: 'md-a', species: 'padouk', plot: 'MD-A-P02', count: 23, diameterCm: 66.2, heightM: 31.4, health: TreeHealthStatus.LOGGED },
    { forest: 'mindourou', zone: 'md-b', species: 'ebene', plot: 'MD-B-P03', count: 7, diameterCm: 44.5, heightM: 22.8, health: TreeHealthStatus.HEALTHY },
    { forest: 'yokadouma', zone: 'yk-a', species: 'sapelli', plot: 'YK-A-P01', count: 38, diameterCm: 99.1, heightM: 43.7, health: TreeHealthStatus.HEALTHY },
    { forest: 'yokadouma', zone: 'yk-a', species: 'sipo', plot: 'YK-A-P02', count: 31, diameterCm: 92.6, heightM: 40.3, health: TreeHealthStatus.HEALTHY },
    { forest: 'yokadouma', zone: 'yk-a', species: 'bubinga', plot: 'YK-A-P03', count: 14, diameterCm: 87.4, heightM: 34.9, health: TreeHealthStatus.HEALTHY },
    { forest: 'yokadouma', zone: 'yk-b', species: 'wenge', plot: 'YK-B-P04', count: 12, diameterCm: 68.3, heightM: 29.6, health: TreeHealthStatus.DAMAGED },
    { forest: 'yokadouma', zone: 'yk-c', species: 'assamela', plot: 'YK-C-P05', count: 9, diameterCm: 79.8, heightM: 38.2, health: TreeHealthStatus.HEALTHY },
    { forest: 'bafut', zone: 'bf-a', species: 'frake', plot: 'BF-A-P01', count: 88, diameterCm: 52.7, heightM: 28.4, health: TreeHealthStatus.HEALTHY },
    { forest: 'bafut', zone: 'bf-a', species: 'ayous', plot: 'BF-A-P02', count: 64, diameterCm: 58.3, heightM: 30.1, health: TreeHealthStatus.HEALTHY },
    { forest: 'bafut', zone: 'bf-b', species: 'padouk', plot: 'BF-B-P03', count: 37, diameterCm: 49.6, heightM: 26.7, health: TreeHealthStatus.HEALTHY },
    { forest: 'bidou', zone: 'bd-a', species: 'azobe', plot: 'BD-A-P01', count: 21, diameterCm: 85.9, heightM: 37.1, health: TreeHealthStatus.HEALTHY },
    { forest: 'bidou', zone: 'bd-a', species: 'tali', plot: 'BD-A-P02', count: 29, diameterCm: 77.2, heightM: 34.5, health: TreeHealthStatus.DEAD },
    { forest: 'bidou', zone: 'bd-a', species: 'padouk', plot: 'BD-A-P03', count: 17, diameterCm: 69.4, heightM: 31.8, health: TreeHealthStatus.HEALTHY },
    { forest: 'korup-buffer', zone: 'kb-a', species: 'moabi', plot: 'KB-A-P01', count: 13, diameterCm: 101.2, heightM: 44.9, health: TreeHealthStatus.HEALTHY },
    { forest: 'korup-buffer', zone: 'kb-a', species: 'iroko', plot: 'KB-A-P02', count: 16, diameterCm: 90.6, heightM: 39.8, health: TreeHealthStatus.HEALTHY },
  ];

  const PLOT_AREA_HA = 0.5;
  let index = 0;
  for (const row of plan) {
    index += 1;
    const zoneSpec = ZONES.find((zone) => zone.key === row.zone) as ZoneSpec;
    const latitude = round(zoneSpec.latitude + (random() - 0.5) * 0.012, 7);
    const longitude = round(zoneSpec.longitude + (random() - 0.5) * 0.012, 7);
    // Standing volume: basal area from the mean diameter, times height, times a
    // 0.5 form factor — the same reasoning a field team applies by hand.
    const basalAreaM2 = (Math.PI / 4) * (row.diameterCm / 100) ** 2;
    const volumeM3 = round(basalAreaM2 * row.heightM * 0.5 * row.count, 2);

    await put('tree inventory', prisma.treeInventory, `demo-inventory-${String(index).padStart(3, '0')}`, {
      forestId: `demo-forest-${row.forest}`,
      zoneId: `demo-zone-${row.zone}`,
      speciesId: speciesIds.get(row.species) as string,
      surveyDate: daysFromNow(-90 - index * 3),
      plotCode: row.plot,
      treesCounted: row.count,
      averageDiameterCm: row.diameterCm,
      averageHeightM: row.heightM,
      volumeM3,
      densityPerHa: round(row.count / PLOT_AREA_HA, 2),
      healthStatus: row.health,
      latitude,
      longitude,
      notes: `Placette de ${PLOT_AREA_HA} ha, inventaire par layon systématique (données de démonstration).`,
      isDemo: true,
      recordedById: userIds.get(index % 3 === 0 ? 'explorer' : 'inspector') as string,
    });
  }
}

async function seedPermits(userIds: Map<string, string>): Promise<void> {
  for (const permit of PERMITS) {
    const id = `demo-permit-${permit.key}`;
    const feeAmount = round(permit.volumeRequestedM3 * ROYALTY_RATE, 2);
    await put('permit', prisma.exploitationPermit, id, {
      permitNumber: permit.permitNumber,
      type: permit.type,
      status: permit.status,
      priority: permit.priority,
      title: permit.title,
      purpose: permit.purpose,
      companyId: `demo-co-${permit.companyKey}`,
      applicantId: userIds.get(permit.companyKey === 'cofcom' ? 'company2' : 'company') as string,
      forestId: `demo-forest-${permit.forestKey}`,
      zoneId: permit.zoneKey ? `demo-zone-${permit.zoneKey}` : null,
      volumeRequestedM3: permit.volumeRequestedM3,
      volumeApprovedM3: permit.volumeApprovedM3 ?? null,
      areaRequestedHa: permit.areaRequestedHa ?? null,
      currency: 'XAF',
      feeAmount,
      royaltyRatePerM3: ROYALTY_RATE,
      startDate: daysFromNow(permit.startDays),
      endDate: daysFromNow(permit.endDays),
      submittedAt: permit.submittedDays === undefined ? null : daysFromNow(permit.submittedDays),
      reviewStartedAt: permit.reviewStartedDays === undefined ? null : daysFromNow(permit.reviewStartedDays),
      reviewedAt: permit.reviewedDays === undefined ? null : daysFromNow(permit.reviewedDays),
      reviewedById: permit.reviewedDays === undefined ? null : userIds.get('officer'),
      approvedAt: permit.approvedDays === undefined ? null : daysFromNow(permit.approvedDays),
      approvedById: permit.approvedDays === undefined ? null : userIds.get('officer'),
      rejectionReason: permit.rejectionReason ?? null,
      revisionNotes: permit.revisionNotes ?? null,
      revisionCount: permit.revisionCount ?? 0,
      activatedAt: permit.activatedDays === undefined ? null : daysFromNow(permit.activatedDays),
      suspendedAt: permit.status === PermitStatus.SUSPENDED ? daysFromNow(-48) : null,
      suspensionReason: permit.suspensionReason ?? null,
      revokedAt: null,
      revocationReason: null,
      expiresAt: permit.expiresDays === undefined ? null : daysFromNow(permit.expiresDays),
      conditions: permit.conditions ?? null,
      isDemo: true,
    });

    // Status history mirrors the timestamps above, in chronological order.
    const history: Array<{ at: number; from: PermitStatus | null; to: PermitStatus; reason: string }> = [];
    if (permit.submittedDays !== undefined)
      history.push({ at: permit.submittedDays, from: PermitStatus.DRAFT, to: PermitStatus.SUBMITTED, reason: 'Dossier déposé au guichet de la délégation.' });
    if (permit.reviewStartedDays !== undefined)
      history.push({ at: permit.reviewStartedDays, from: PermitStatus.SUBMITTED, to: PermitStatus.UNDER_REVIEW, reason: 'Instruction ouverte par le service provincial.' });
    if (permit.revisionNotes)
      history.push({ at: (permit.reviewStartedDays ?? 0) + 2, from: PermitStatus.UNDER_REVIEW, to: PermitStatus.REVISION_REQUIRED, reason: permit.revisionNotes });
    if (permit.rejectionReason)
      history.push({ at: permit.reviewedDays ?? 0, from: PermitStatus.UNDER_REVIEW, to: PermitStatus.REJECTED, reason: permit.rejectionReason });
    if (permit.approvedDays !== undefined)
      history.push({ at: permit.approvedDays, from: PermitStatus.UNDER_REVIEW, to: PermitStatus.APPROVED, reason: 'Permis approuvé, sous réserve du paiement de la taxe.' });
    if (permit.status === PermitStatus.PAYMENT_PENDING)
      history.push({ at: permit.approvedDays ?? 0, from: PermitStatus.APPROVED, to: PermitStatus.PAYMENT_PENDING, reason: 'Taxe d’exploitation en attente de règlement.' });
    if (permit.activatedDays !== undefined)
      history.push({ at: permit.activatedDays, from: PermitStatus.PAYMENT_PENDING, to: PermitStatus.ACTIVE, reason: 'Paiement vérifié : permis opérationnel.' });
    if (permit.status === PermitStatus.EXPIRED)
      history.push({ at: permit.expiresDays ?? 0, from: PermitStatus.ACTIVE, to: PermitStatus.EXPIRED, reason: 'Fin de validité du permis.' });
    if (permit.status === PermitStatus.SUSPENDED)
      history.push({ at: -48, from: PermitStatus.ACTIVE, to: PermitStatus.SUSPENDED, reason: permit.suspensionReason ?? 'Suspension administrative.' });

    let order = 0;
    for (const entry of history.sort((a, b) => a.at - b.at)) {
      order += 1;
      const historyId = `demo-ph-${permit.key}-${String(order).padStart(2, '0')}`;
      await putComposite(
        'permit history',
        prisma.permitStatusHistory,
        { id: historyId },
        {
          id: historyId,
          permitId: id,
          fromStatus: entry.from,
          toStatus: entry.to,
          changedById: userIds.get('officer'),
          reason: entry.reason,
          metadataJson: JSON.stringify({ seeded: true, isDemo: true }),
          createdAt: daysFromNow(entry.at),
        },
      );
    }

    if (permit.status === PermitStatus.ACTIVE || permit.status === PermitStatus.EXPIRED) {
      await put('permit document', prisma.permitDocument, `demo-pdoc-${permit.key}`, {
        permitId: id,
        type: DocumentType.EXPLOITATION_LICENCE,
        title: `Titre d’exploitation — ${permit.permitNumber}`,
        fileUrl: `/files/demo/permit-${permit.key}.pdf`,
        fileKey: `permits/documents/demo-${permit.key}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 385_400,
        isVerified: true,
        verifiedById: userIds.get('officer'),
        uploadedById: actorForCompany(userIds, permit.companyKey),
        notes: 'Titre signé et enregistré au dossier du permis.',
      });
    }
  }
}

async function seedActivities(userIds: Map<string, string>, speciesIds: Map<string, string>): Promise<void> {
  for (const activity of ACTIVITIES) {
    const permit = PERMITS.find((candidate) => candidate.key === activity.permitKey) as PermitSpec;
    const id = `demo-act-${activity.key}`;
    await put('activity', prisma.exploitationActivity, id, {
      reference: `DEMO-ACT-2026-${activity.key.slice(1).padStart(4, '0')}`,
      permitId: `demo-permit-${activity.permitKey}`,
      companyId: `demo-co-${permit.companyKey}`,
      forestId: `demo-forest-${permit.forestKey}`,
      zoneId: permit.zoneKey ? `demo-zone-${permit.zoneKey}` : null,
      activityType: activity.activityType,
      status: activity.status,
      plannedVolumeM3: activity.plannedVolumeM3,
      harvestedVolumeM3: activity.harvestedVolumeM3,
      harvestedTreeCount: activity.harvestedTreeCount,
      plannedStartDate: daysFromNow(activity.plannedStartDays),
      plannedEndDate: daysFromNow(activity.plannedEndDays),
      actualStartDate: activity.actualStartDays === undefined ? null : daysFromNow(activity.actualStartDays),
      actualEndDate: activity.actualEndDays === undefined ? null : daysFromNow(activity.actualEndDays),
      latitude: activity.latitude,
      longitude: activity.longitude,
      locationAccuracyM: activity.accuracyM,
      gpsCapturedAt: daysFromNow(activity.gpsCapturedDays, 7),
      gpsSource: GpsSource.SEED_DEMO,
      equipmentSummary: activity.equipmentSummary,
      observations: activity.observations,
      speciesBreakdownJson: activity.species.length
        ? JSON.stringify(
            activity.species.map((row) => {
              const species = SPECIES.find((candidate) => candidate.key === row.speciesKey) as SpeciesSpec;
              return {
                speciesId: speciesIds.get(row.speciesKey) as string,
                scientificName: species.scientificName,
                commonName: species.commonName,
                volumeM3: row.volumeM3,
                trees: row.trees,
              };
            }),
          )
        : null,
      createdById: actorForCompany(userIds, permit.companyKey),
      // Field operators are assigned to their own company's work; every other
      // activity is assigned to the account of the company that owns it.
      assignedToId:
        activity.assignedTo === 'operator'
          ? (userIds.get('operator') as string)
          : actorForCompany(userIds, permit.companyKey),
      isDemo: true,
      syncStatus: activity.syncStatus,
      clientRef: activity.clientRef,
    });

    await put('gis feature', prisma.gISLocation, `demo-gis-act-${activity.key}`, {
      featureType: 'EXPLOITATION_ACTIVITY',
      entityId: id,
      label: `${activity.activityType} — ${activity.latitude.toFixed(4)}, ${activity.longitude.toFixed(4)}`,
      latitude: activity.latitude,
      longitude: activity.longitude,
      accuracyM: activity.accuracyM,
      source: GpsSource.SEED_DEMO,
      forestId: `demo-forest-${permit.forestKey}`,
      zoneId: permit.zoneKey ? `demo-zone-${permit.zoneKey}` : null,
      activityId: id,
      recordedById: userIds.get(activity.assignedTo),
      recordedAt: daysFromNow(activity.gpsCapturedDays, 7),
      isDemo: true,
      metadataJson: JSON.stringify({ status: activity.status, activityType: activity.activityType, isDemo: true }),
    });
  }

  // Equipment usage on the harvest and transport activities.
  const usage: Array<{ activity: string; equipment: string; hours: number; fuel: number; operator: string }> = [
    { activity: 'a1', equipment: 'eq1', hours: 412.5, fuel: 3_180, operator: 'Équipe d’abattage — atelier A' },
    { activity: 'a1', equipment: 'eq2', hours: 268, fuel: 410, operator: 'Chef d’équipe Njoya' },
    { activity: 'a1', equipment: 'eq4', hours: 196.5, fuel: 1_240, operator: 'Conducteur débusqueur Mballa' },
    { activity: 'a2', equipment: 'eq1', hours: 158, fuel: 1_220, operator: 'Équipe d’abattage — atelier A' },
    { activity: 'a2', equipment: 'eq2', hours: 96, fuel: 148, operator: 'Chef d’équipe Njoya' },
    { activity: 'a3', equipment: 'eq3', hours: 214, fuel: 2_640, operator: 'Transporteur Atangana' },
    { activity: 'a5', equipment: 'eq4', hours: 88.5, fuel: 720, operator: 'Conducteur bulldozer Ngono' },
    { activity: 'a6', equipment: 'eq5', hours: 640, fuel: 4_100, operator: 'Équipe UFA 10-008' },
    { activity: 'a7', equipment: 'eq5', hours: 312, fuel: 2_050, operator: 'Équipe UFA 10-008' },
    { activity: 'a8', equipment: 'eq6', hours: 141.5, fuel: 1_460, operator: 'Conducteur bulldozer Onana' },
    { activity: 'a11', equipment: 'eq8', hours: 132, fuel: 860, operator: 'Coopérative COFCOM' },
    { activity: 'a12', equipment: 'eq8', hours: 64.5, fuel: 420, operator: 'Coopérative COFCOM' },
    { activity: 'a13', equipment: 'eq3', hours: 176, fuel: 2_180, operator: 'Transporteur Atangana' },
    { activity: 'a14', equipment: 'eq2', hours: 54, fuel: 82, operator: 'Équipe récupération chablis' },
  ];

  for (const row of usage) {
    await putComposite(
      'equipment usage',
      prisma.activityEquipmentUsage,
      { activityId_equipmentId: { activityId: `demo-act-${row.activity}`, equipmentId: `demo-eq-${row.equipment}` } },
      {
        activityId: `demo-act-${row.activity}`,
        equipmentId: `demo-eq-${row.equipment}`,
        operatorName: row.operator,
        hoursUsed: row.hours,
        fuelLitres: row.fuel,
        notes: 'Relevé mensuel (démonstration).',
      },
    );
  }
}

async function seedEquipment(userIds: Map<string, string>): Promise<void> {
  for (const item of EQUIPMENT) {
    await put('equipment', prisma.equipment, `demo-eq-${item.key}`, {
      companyId: `demo-co-${item.companyKey}`,
      name: item.name,
      category: item.category,
      status: item.status,
      registrationNumber: item.registrationNumber,
      serialNumber: item.serialNumber,
      manufacturer: item.manufacturer,
      model: item.model,
      acquiredAt: daysFromNow(item.acquiredDays),
      lastMaintenanceAt: daysFromNow(item.lastMaintenanceDays),
      nextMaintenanceAt: daysFromNow(item.nextMaintenanceDays),
      capacityM3: item.capacityM3,
      notes: item.notes,
      isDemo: true,
      createdById: actorForCompany(userIds, item.companyKey),
    });
  }
}

async function seedPayments(userIds: Map<string, string>): Promise<void> {
  let index = 0;
  for (const payment of PAYMENTS) {
    index += 1;
    const reference = `DEMO-PAY-2026-${String(index).padStart(4, '0')}`;
    const payingCompanyKey = payment.permitKey
      ? (PERMITS.find((permit) => permit.key === payment.permitKey) as PermitSpec).companyKey
      : payment.violationKey
        ? (VIOLATIONS.find((violation) => violation.key === payment.violationKey) as ViolationSpec).companyKey ?? 'smds'
        : payment.payer === 'company'
          ? 'smds'
          : 'cofcom';
    const payingActor = actorForCompany(userIds, payingCompanyKey);
    await put('payment', prisma.payment, `demo-pay-${payment.key}`, {
      reference,
      purpose: payment.purpose,
      status: payment.status,
      provider: PaymentProvider.SIMULATOR,
      method: payment.method,
      amount: payment.amount,
      currency: 'XAF',
      providerReference: payment.status === PaymentStatus.SUCCESSFUL ? `SIM-${reference}-${index * 7}` : null,
      providerPhone: payment.payer === 'company' ? '+237 677 65 03 91' : '+237 655 27 84 19',
      providerPayloadJson:
        payment.status === PaymentStatus.SUCCESSFUL
          ? JSON.stringify({
              provider: 'SIMULATOR',
              note: 'Enregistrement du fournisseur local de démonstration — aucune transaction Campay.',
              reference,
              amount: payment.amount,
              currency: 'XAF',
              simulatedAt: daysFromNow(payment.processedDays ?? payment.initiatedDays).toISOString(),
            })
          : null,
      receiptNumber: payment.status === PaymentStatus.SUCCESSFUL ? `DEMO-RCP-2026-${String(index).padStart(4, '0')}` : null,
      failureReason:
        payment.status === PaymentStatus.FAILED
          ? 'Prélèvement refusé par le fournisseur simulé : solde insuffisant.'
          : payment.status === PaymentStatus.CANCELLED
            ? 'Paiement annulé par l’entreprise avant validation.'
            : null,
      initiatedAt: daysFromNow(payment.initiatedDays),
      processedAt: payment.processedDays === undefined ? null : daysFromNow(payment.processedDays),
      paidAt: payment.paidDays === undefined ? null : daysFromNow(payment.paidDays),
      verifiedAt: payment.verifiedDays === undefined ? null : daysFromNow(payment.verifiedDays),
      refundedAt: payment.status === PaymentStatus.REFUNDED ? daysFromNow(payment.processedDays ?? payment.initiatedDays) : null,
      payerId: payingActor,
      companyId: `demo-co-${payingCompanyKey}`,
      permitId: payment.permitKey ? `demo-permit-${payment.permitKey}` : null,
      violationId: payment.violationKey ? `demo-vio-${payment.violationKey}` : null,
      initiatedById: payingActor,
      verifiedById: payment.verifiedDays === undefined ? null : userIds.get('officer'),
      notes: `${payment.notes} Paiement enregistré par le simulateur local de démonstration (PAYMENT_PROVIDER=simulator), et non par Campay.`,
      isDemo: true,
      syncStatus: SyncStatus.SYNCED,
      clientRef: `demo-payment-${payment.key}`,
    });
  }
}

async function seedInspections(userIds: Map<string, string>): Promise<void> {
  for (const inspection of INSPECTIONS) {
    const id = `demo-insp-${inspection.key}`;
    await put('inspection', prisma.inspection, id, {
      reference: inspection.reference,
      type: inspection.type,
      status: inspection.status,
      outcome: inspection.outcome ?? null,
      complianceScore: inspection.complianceScore ?? null,
      title: inspection.title,
      summary: inspection.summary,
      recommendations: inspection.recommendations,
      forestId: `demo-forest-${inspection.forestKey}`,
      zoneId: inspection.zoneKey ? `demo-zone-${inspection.zoneKey}` : null,
      protectedAreaId: inspection.protectedAreaKey ? `demo-pa-${inspection.protectedAreaKey}` : null,
      companyId: inspection.companyKey ? `demo-co-${inspection.companyKey}` : null,
      permitId: inspection.permitKey ? `demo-permit-${inspection.permitKey}` : null,
      activityId: inspection.activityKey ? `demo-act-${inspection.activityKey}` : null,
      inspectorId: userIds.get(inspection.inspector) as string,
      assignedById: userIds.get('officer'),
      reviewedById: inspection.reviewedDays === undefined ? null : userIds.get('officer'),
      scheduledFor: daysFromNow(inspection.scheduledDays),
      startedAt: inspection.startedDays === undefined ? null : daysFromNow(inspection.startedDays, 8),
      completedAt: inspection.completedDays === undefined ? null : daysFromNow(inspection.completedDays, 15),
      submittedAt: inspection.submittedDays === undefined ? null : daysFromNow(inspection.submittedDays, 16),
      reviewedAt: inspection.reviewedDays === undefined ? null : daysFromNow(inspection.reviewedDays, 9),
      latitude: inspection.latitude,
      longitude: inspection.longitude,
      locationAccuracyM: inspection.accuracyM,
      gpsCapturedAt: daysFromNow(inspection.gpsCapturedDays, 8),
      gpsSource: GpsSource.SEED_DEMO,
      distanceFromTargetM: inspection.distanceFromTargetM,
      verifiedHarvestedVolumeM3: inspection.verifiedHarvestedVolumeM3 ?? null,
      verifiedTreeCount: inspection.verifiedTreeCount ?? null,
      discrepancies: inspection.discrepancies ?? null,
      isDemo: true,
      syncStatus: SyncStatus.SYNCED,
      clientRef: inspection.clientRef,
    });

    const answers =
      inspection.status === InspectionStatus.SCHEDULED || inspection.status === InspectionStatus.CANCELLED
        ? []
        : defaultChecklist(inspection.type);
    let order = 0;
    for (const item of answers) {
      order += 1;
      const failing = inspection.discrepancies
        ? order === 1
        : (inspection.complianceScore ?? 100) < 80
          ? order === 2
          : false;
      await putComposite(
        'checklist item',
        prisma.inspectionChecklistItem,
        { inspectionId_code: { inspectionId: id, code: item.code } },
        {
          inspectionId: id,
          code: item.code,
          label: item.label,
          result: failing ? 'FAIL' : 'PASS',
          notes: failing ? 'Écart constaté et consigné au procès-verbal de la mission.' : 'Conforme lors de la visite.',
          sortOrder: order,
        },
      );
    }

    await put('gis feature', prisma.gISLocation, `demo-gis-insp-${inspection.key}`, {
      featureType: 'INSPECTION',
      entityId: id,
      label: inspection.title,
      latitude: inspection.latitude,
      longitude: inspection.longitude,
      accuracyM: inspection.accuracyM,
      source: GpsSource.SEED_DEMO,
      forestId: `demo-forest-${inspection.forestKey}`,
      zoneId: inspection.zoneKey ? `demo-zone-${inspection.zoneKey}` : null,
      protectedAreaId: inspection.protectedAreaKey ? `demo-pa-${inspection.protectedAreaKey}` : null,
      inspectionId: id,
      recordedById: userIds.get(inspection.inspector),
      recordedAt: daysFromNow(inspection.gpsCapturedDays, 8),
      isDemo: true,
      metadataJson: JSON.stringify({ status: inspection.status, outcome: inspection.outcome ?? null, isDemo: true }),
    });
  }
}

async function seedViolations(userIds: Map<string, string>): Promise<void> {
  for (const violation of VIOLATIONS) {
    const id = `demo-vio-${violation.key}`;
    await put('violation', prisma.environmentalViolation, id, {
      reference: violation.reference,
      title: violation.title,
      description: violation.description,
      // `severity` below is cast through the enum list to keep the type strict.
      severity: (violation.severity as ViolationSeverity),
      status: violation.status,
      forestId: `demo-forest-${violation.forestKey}`,
      zoneId: violation.zoneKey ? `demo-zone-${violation.zoneKey}` : null,
      protectedAreaId: violation.protectedAreaKey ? `demo-pa-${violation.protectedAreaKey}` : null,
      companyId: violation.companyKey ? `demo-co-${violation.companyKey}` : null,
      permitId: violation.permitKey ? `demo-permit-${violation.permitKey}` : null,
      activityId: violation.activityKey ? `demo-act-${violation.activityKey}` : null,
      inspectionId: violation.inspectionKey ? `demo-insp-${violation.inspectionKey}` : null,
      latitude: violation.latitude,
      longitude: violation.longitude,
      detectedAt: daysFromNow(violation.detectedDays, 10),
      detectedById: userIds.get(violation.inspectionKey ? 'inspector' : 'environment') as string,
      estimatedDamageXAF: violation.estimatedDamageXAF,
      penaltyAmountXAF: violation.penaltyAmountXAF,
      remediationRequired: violation.remediationRequired,
      remediationDeadline:
        violation.remediationRequired && violation.remediationDays
          ? daysFromNow(violation.detectedDays + violation.remediationDays)
          : null,
      remediationNotes: violation.remediationNotes ?? null,
      investigationNotes: violation.investigationNotes,
      resolvedAt: violation.resolvedDays === undefined ? null : daysFromNow(violation.resolvedDays, 11),
      resolvedById: violation.resolvedDays === undefined ? null : userIds.get('environment'),
      resolutionSummary: violation.resolutionSummary ?? null,
      isDemo: true,
    });

    await put('gis feature', prisma.gISLocation, `demo-gis-vio-${violation.key}`, {
      featureType: 'ENVIRONMENTAL_VIOLATION',
      entityId: id,
      label: violation.reference,
      latitude: violation.latitude,
      longitude: violation.longitude,
      source: GpsSource.SEED_DEMO,
      forestId: `demo-forest-${violation.forestKey}`,
      zoneId: violation.zoneKey ? `demo-zone-${violation.zoneKey}` : null,
      violationId: id,
      recordedById: userIds.get('environment'),
      recordedAt: daysFromNow(violation.detectedDays, 10),
      isDemo: true,
      metadataJson: JSON.stringify({ severity: violation.severity, status: violation.status, isDemo: true }),
    });
  }
}

async function seedObservations(userIds: Map<string, string>): Promise<void> {
  for (const observation of OBSERVATIONS) {
    const id = `demo-obs-${observation.key}`;
    await put('observation', prisma.fieldObservation, id, {
      forestId: `demo-forest-${observation.forestKey}`,
      zoneId: observation.zoneKey ? `demo-zone-${observation.zoneKey}` : null,
      protectedAreaId: observation.protectedAreaKey ? `demo-pa-${observation.protectedAreaKey}` : null,
      activityId: observation.activityKey ? `demo-act-${observation.activityKey}` : null,
      inspectionId: observation.inspectionKey ? `demo-insp-${observation.inspectionKey}` : null,
      category: observation.category,
      severity: observation.severity,
      title: observation.title,
      description: observation.description,
      latitude: observation.latitude,
      longitude: observation.longitude,
      locationAccuracyM: observation.accuracyM,
      capturedAt: daysFromNow(observation.capturedDays, 9),
      gpsSource: GpsSource.SEED_DEMO,
      observedById: userIds.get(observation.observer) as string,
      isDemo: true,
      aiProcessedAt: daysFromNow(observation.capturedDays + 1, 4),
      syncStatus: observation.syncStatus,
      clientRef: observation.clientRef,
    });

    await put('gis feature', prisma.gISLocation, `demo-gis-obs-${observation.key}`, {
      featureType: 'FIELD_OBSERVATION',
      entityId: id,
      label: observation.title,
      latitude: observation.latitude,
      longitude: observation.longitude,
      accuracyM: observation.accuracyM,
      source: GpsSource.SEED_DEMO,
      forestId: `demo-forest-${observation.forestKey}`,
      zoneId: observation.zoneKey ? `demo-zone-${observation.zoneKey}` : null,
      observationId: id,
      recordedById: userIds.get(observation.observer),
      recordedAt: daysFromNow(observation.capturedDays, 9),
      isDemo: true,
      metadataJson: JSON.stringify({ category: observation.category, severity: observation.severity, isDemo: true }),
    });
  }
}

async function seedFieldSessions(userIds: Map<string, string>): Promise<void> {
  const sessions: Array<{
    key: string;
    user: 'operator' | 'inspector' | 'environment';
    forest: string;
    zone: string;
    activity?: string;
    status: FieldSessionStatus;
    startDays: number;
    endDays?: number;
    start: [number, number];
    end?: [number, number];
    notes: string;
  }> = [
    {
      key: 'fs1',
      user: 'operator',
      forest: 'djoum',
      zone: 'dj-a',
      activity: 'a2',
      status: FieldSessionStatus.COMPLETED,
      startDays: -3,
      endDays: -3,
      start: [2.8021, 12.8534],
      end: [2.8033, 12.8541],
      notes: 'Session de pointage et de saisie du registre de coupe de la bande 3.',
    },
    {
      key: 'fs2',
      user: 'inspector',
      forest: 'yokadouma',
      zone: 'yk-a',
      activity: 'a7',
      status: FieldSessionStatus.COMPLETED,
      startDays: -9,
      endDays: -9,
      start: [3.4862, 14.7568],
      end: [3.4879, 14.7602],
      notes: 'Vérification contradictoire des cubages de la bande 3.',
    },
    {
      key: 'fs3',
      user: 'environment',
      forest: 'korup-buffer',
      zone: 'kb-a',
      status: FieldSessionStatus.ACTIVE,
      startDays: 0,
      start: [5.0342, 8.8661],
      notes: 'Mission de terrain en cours : relevé des limites de la zone tampon.',
    },
  ];

  for (const session of sessions) {
    await put('field session', prisma.fieldSession, `demo-fs-${session.key}`, {
      userId: userIds.get(session.user) as string,
      activityId: session.activity ? `demo-act-${session.activity}` : null,
      forestId: `demo-forest-${session.forest}`,
      zoneId: `demo-zone-${session.zone}`,
      status: session.status,
      startedAt: daysFromNow(session.startDays, 7),
      endedAt: session.endDays === undefined ? null : daysFromNow(session.endDays, 15),
      startLatitude: session.start[0],
      startLongitude: session.start[1],
      endLatitude: session.end ? session.end[0] : null,
      endLongitude: session.end ? session.end[1] : null,
      startAccuracyM: 5.4,
      deviceInfoJson: JSON.stringify({
        platform: 'demo-seed',
        gpsSource: GpsSource.SEED_DEMO,
        note: 'Position de démonstration, capturée hors application mobile.',
      }),
      notes: session.notes,
      syncStatus: SyncStatus.SYNCED,
      clientRef: `demo-session-${session.key}`,
    });
  }
}

async function seedEvidence(userIds: Map<string, string>): Promise<void> {
  const evidence: Array<{
    key: string;
    title: string;
    caption: string;
    type: EvidenceType;
    inspection?: string;
    activity?: string;
    observation?: string;
    violation?: string;
    permit?: string;
    company?: string;
    latitude: number;
    longitude: number;
    capturedDays: number;
    uploader: 'inspector' | 'environment' | 'operator' | 'company';
  }> = [
    {
      key: 'e1',
      title: 'Piste ouverte en bordure du cours d’eau',
      caption: 'Photo prise depuis le point GPS 3.5137 / 14.7880, montrant la distance à la rive.',
      type: EvidenceType.PHOTO,
      inspection: 'i3',
      violation: 'v2',
      company: 'efe',
      latitude: 3.5137,
      longitude: 14.788,
      capturedDays: -50,
      uploader: 'inspector',
    },
    {
      key: 'e2',
      title: 'Procès-verbal de constat signé sur site',
      caption: 'PV contradictoire signé par l’inspecteur et le chef de chantier.',
      type: EvidenceType.SIGNATURE,
      inspection: 'i3',
      violation: 'v2',
      company: 'efe',
      latitude: 3.5137,
      longitude: 14.788,
      capturedDays: -50,
      uploader: 'inspector',
    },
    {
      key: 'e3',
      title: 'Sol imprégné d’huile hydraulique',
      caption: 'Aire de sciage, environ 40 m² de sol souillé avant excavation.',
      type: EvidenceType.PHOTO,
      inspection: 'i2',
      observation: 'o11',
      violation: 'v3',
      company: 'efe',
      latitude: 3.4888,
      longitude: 14.7585,
      capturedDays: -71,
      uploader: 'environment',
    },
    {
      key: 'e4',
      title: 'Relevé de cubage contradictoire',
      caption: 'Feuille de mesurage de 40 arbres abattus, bande 3 de l’UFA 10-008.',
      type: EvidenceType.DOCUMENT,
      inspection: 'i6',
      permit: 'p1',
      company: 'smds',
      latitude: 2.8023,
      longitude: 12.8531,
      capturedDays: -2,
      uploader: 'inspector',
    },
    {
      key: 'e5',
      title: 'Balise de la zone sacrée',
      caption: 'Piquet peint délimitant la zone sacrée exclue de l’exploitation communautaire.',
      type: EvidenceType.PHOTO,
      inspection: 'i4',
      company: 'cofcom',
      latitude: 3.5015,
      longitude: 13.8821,
      capturedDays: -99,
      uploader: 'environment',
    },
    {
      key: 'e6',
      title: 'Bordereau de transport de grumes',
      caption: 'Exemplaire signé du bordereau accompagnant le convoi Djoum → Bertoua.',
      type: EvidenceType.DOCUMENT,
      activity: 'a13',
      permit: 'p11',
      company: 'smds',
      latitude: 2.8004,
      longitude: 12.8421,
      capturedDays: -12,
      uploader: 'operator',
    },
    {
      key: 'e7',
      title: 'Ouverture de la piste d’accès principale',
      caption: 'Vue de la piste et de ses fossés drainants à la fin des travaux.',
      type: EvidenceType.PHOTO,
      activity: 'a5',
      permit: 'p1',
      company: 'smds',
      latitude: 2.7892,
      longitude: 12.8338,
      capturedDays: -88,
      uploader: 'operator',
    },
    {
      key: 'e8',
      title: 'Récépissé de dépollution du site',
      caption: 'Bordereau du centre agréé de Bertoua pour l’évacuation des terres souillées.',
      type: EvidenceType.DOCUMENT,
      violation: 'v3',
      permit: 'p3',
      company: 'efe',
      latitude: 3.4889,
      longitude: 14.7583,
      capturedDays: -22,
      uploader: 'company',
    },
  ];

  for (const item of evidence) {
    await put('evidence', prisma.evidence, `demo-evid-${item.key}`, {
      type: item.type,
      source: EvidenceSource.FILE_UPLOAD,
      title: item.title,
      caption: item.caption,
      fileUrl: `/files/demo/evidence-${item.key}.${item.type === EvidenceType.DOCUMENT ? 'pdf' : 'jpg'}`,
      fileKey: `inspections/evidence/demo-${item.key}.${item.type === EvidenceType.DOCUMENT ? 'pdf' : 'jpg'}`,
      mimeType: item.type === EvidenceType.DOCUMENT ? 'application/pdf' : 'image/jpeg',
      sizeBytes: item.type === EvidenceType.DOCUMENT ? 512_000 : 1_840_000,
      latitude: item.latitude,
      longitude: item.longitude,
      locationAccuracyM: 6.2,
      capturedAt: daysFromNow(item.capturedDays, 11),
      gpsSource: GpsSource.SEED_DEMO,
      inspectionId: item.inspection ? `demo-insp-${item.inspection}` : null,
      activityId: item.activity ? `demo-act-${item.activity}` : null,
      observationId: item.observation ? `demo-obs-${item.observation}` : null,
      violationId: item.violation ? `demo-vio-${item.violation}` : null,
      permitId: item.permit ? `demo-permit-${item.permit}` : null,
      companyId: item.company ? `demo-co-${item.company}` : null,
      uploadedById: item.uploader === 'company' ? actorForCompany(userIds, item.company) : (userIds.get(item.uploader) as string),
      syncStatus: SyncStatus.SYNCED,
      clientRef: `demo-evidence-${item.key}`,
    });
  }
}

async function seedReports(userIds: Map<string, string>): Promise<void> {
  const reports: Array<{
    key: string;
    type: ReportType;
    title: string;
    summary: Record<string, unknown>;
    forest?: string;
    company?: string;
    permit?: string;
    generatedBy: 'officer' | 'admin';
    createdDays: number;
  }> = [
    {
      key: 'r1',
      type: ReportType.PERMITS,
      title: 'État des permis d’exploitation — campagne 2026 (démonstration)',
      summary: {
        total: 12,
        active: 4,
        pending: 3,
        rejected: 1,
        volumeApprovedM3: 47_400,
        note: 'Rapport de démonstration généré à partir du jeu de données de seed.',
      },
      generatedBy: 'officer',
      createdDays: -20,
    },
    {
      key: 'r2',
      type: ReportType.EXPLOITATION_ACTIVITIES,
      title: 'Volumes exploités par forêt — premier semestre 2026 (démonstration)',
      summary: {
        forests: [
          { code: 'FD-DJOUM', harvestedM3: 1_968 },
          { code: 'UFA-YOKADOUMA-10-008', harvestedM3: 6_309 },
          { code: 'FC-MINDOUROU', harvestedM3: 976 },
        ],
        totalHarvestedM3: 9_253,
        note: 'Rapport de démonstration généré à partir du jeu de données de seed.',
      },
      forest: 'yokadouma',
      generatedBy: 'officer',
      createdDays: -12,
    },
    {
      key: 'r3',
      type: ReportType.COMPLIANCE_SUMMARY,
      title: 'Indice de conformité des entreprises suivies (démonstration)',
      summary: {
        companies: [
          { name: 'Scierie Moderne du Dja SA', score: 92, rating: 'EXCELLENT' },
          { name: 'Exploitation Forestière de l’Est SA', score: 64, rating: 'ATTENTION' },
          { name: 'Coopérative Forestière Communautaire de Mindourou', score: 78, rating: 'SATISFAISANT' },
        ],
        note: 'Rapport de démonstration généré à partir du jeu de données de seed.',
      },
      company: 'smds',
      generatedBy: 'officer',
      createdDays: -8,
    },
    {
      key: 'r4',
      type: ReportType.ENVIRONMENTAL_VIOLATIONS,
      title: 'Suivi des infractions environnementales en cours (démonstration)',
      summary: {
        open: 3,
        underInvestigation: 1,
        confirmed: 1,
        resolved: 2,
        penaltiesOutstandingXAF: 750_000,
        note: 'Rapport de démonstration généré à partir du jeu de données de seed.',
      },
      forest: 'yokadouma',
      generatedBy: 'admin',
      createdDays: -4,
    },
  ];

  for (const report of reports) {
    await put('report', prisma.report, `demo-report-${report.key}`, {
      reference: `DEMO-REP-2026-${report.key.slice(1).padStart(4, '0')}`,
      type: report.type,
      format: ReportFormat.JSON,
      status: ReportStatus.DRAFT,
      title: report.title,
      parametersJson: JSON.stringify({
        periodFrom: daysFromNow(-180).toISOString(),
        periodTo: daysFromNow(0).toISOString(),
        seeded: true,
        isDemo: true,
      }),
      summaryJson: JSON.stringify(report.summary),
      dateFrom: daysFromNow(-180),
      dateTo: daysFromNow(0),
      forestId: report.forest ? `demo-forest-${report.forest}` : null,
      companyId: report.company ? `demo-co-${report.company}` : null,
      permitId: report.permit ? `demo-permit-${report.permit}` : null,
      generatedById: userIds.get(report.generatedBy) as string,
      generatedAt: daysFromNow(report.createdDays, 12),
      isDemo: true,
    });
  }
}

async function seedIntelligence(userIds: Map<string, string>): Promise<void> {
  const requestedById = userIds.get('officer') as string;
  const analysisId = 'demo-analysis-0001';
  const startedAt = daysFromNow(-1, 4);

  const dataset = await buildIntelligenceDataset(prisma as unknown as PrismaService, {}, { periodDays: 365 });
  const outcome = runRules(dataset);

  // The alerts carry a foreign key to the analysis, so the row is created first
  // (exactly like `AiService.runAnalysis`: RUNNING, then COMPLETED with results).
  await put('ai analysis', prisma.aIAnalysis, analysisId, {
    type: AiAnalysisType.RISK_ASSESSMENT,
    status: AiAnalysisStatus.RUNNING,
    provider: AiProvider.LOCAL_RULE_ENGINE,
    model: DETECTOR_VERSION,
    promptText: 'Seed de démonstration — analyse complète du jeu de données (aucun appel à un fournisseur externe).',
    responseJson: null,
    resultJson: null,
    summary: null,
    riskLevel: null,
    confidence: null,
    entityType: null,
    entityId: null,
    forestId: null,
    zoneId: null,
    latencyMs: null,
    tokensUsed: null,
    errorMessage: null,
    requestedById,
    startedAt,
    completedAt: null,
  });

  const created: Array<{ id: string; reference: string; type: string; riskLevel: string }> = [];
  let index = 0;
  for (const finding of outcome.findings) {
    index += 1;
    const id = `demo-alert-${String(index).padStart(4, '0')}`;
    const reference = `DEMO-ALR-2026-${String(index).padStart(4, '0')}`;
    const record = {
      type: finding.type,
      status: AlertStatus.NEW,
      riskLevel: finding.riskLevel,
      confidence: finding.confidence,
      detector: AiProvider.LOCAL_RULE_ENGINE,
      title: finding.title.slice(0, 191),
      description: finding.description,
      reasoning: finding.reasoning,
      entityType: finding.entityType,
      entityId: finding.entityId,
      forestId: finding.forestId,
      zoneId: finding.zoneId,
      protectedAreaId: finding.protectedAreaId,
      companyId: finding.companyId,
      permitId: finding.permitId,
      activityId: finding.activityId,
      inspectionId: finding.inspectionId,
      observationId: finding.observationId,
      latitude: finding.latitude,
      longitude: finding.longitude,
    };

    await put('ai alert', prisma.aIAlert, id, {
      ...record,
      reference,
      analysisId,
      detectedAt: dataset.generatedAt,
    });
    created.push({ id, reference, type: finding.type, riskLevel: finding.riskLevel });

    if (finding.latitude !== null && finding.longitude !== null) {
      await put('gis feature', prisma.gISLocation, `demo-gis-alert-${String(index).padStart(4, '0')}`, {
        featureType: 'AI_ALERT',
        entityId: id,
        label: finding.title.slice(0, 191),
        latitude: finding.latitude,
        longitude: finding.longitude,
        source: GpsSource.SEED_DEMO,
        forestId: finding.forestId,
        zoneId: finding.zoneId,
        aiAlertId: id,
        recordedById: requestedById,
        recordedAt: dataset.generatedAt,
        isDemo: true,
        metadataJson: JSON.stringify({ riskLevel: finding.riskLevel, type: finding.type, isDemo: true }),
      });
    }
  }

  const resultPayload = {
    detectorVersion: DETECTOR_VERSION,
    provider: AiProvider.LOCAL_RULE_ENGINE,
    rulesEvaluated: outcome.rulesEvaluated,
    duplicatesSkipped: outcome.duplicates,
    byRisk: outcome.byRisk,
    byType: outcome.byType,
    findings: outcome.findings.map((finding) => ({
      code: finding.code,
      type: finding.type,
      riskLevel: finding.riskLevel,
      confidence: finding.confidence,
      title: finding.title,
      entityType: finding.entityType,
      entityId: finding.entityId,
      reasoning: finding.reasoning,
    })),
    alertsRaised: created,
    warnings: outcome.warnings,
    seeded: true,
    note: 'Analyse produite par le moteur de règles déterministe pendant le seed de démonstration.',
  };

  await prisma.aIAnalysis.update({
    where: { id: analysisId },
    data: {
      status: AiAnalysisStatus.COMPLETED,
    resultJson: JSON.stringify(resultPayload),
    summary: [
      `Moteur de règles ${DETECTOR_VERSION} exécuté sur le jeu de démonstration :`,
      `${outcome.rulesEvaluated} règles évaluées, ${outcome.findings.length} signal(s) retenu(s).`,
      outcome.byRisk.CRITICAL ? `${outcome.byRisk.CRITICAL} signal(aux) de niveau critique.` : 'Aucun signal critique.',
      'Ces signalements sont des pistes à instruire : ils ne constatent aucune infraction et ne désignent aucune personne coupable.',
    ].join(' '),
    riskLevel: outcome.findings.length ? RiskLevel.MODERATE : RiskLevel.LOW,
    confidence: outcome.findings.length ? 0.7 : 0,
    entityType: null,
    entityId: null,
    forestId: null,
    zoneId: null,
    latencyMs: 42,
    tokensUsed: null,
    errorMessage: null,
    requestedById,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 42),
    },
  });
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('FEMS demo seed — données de démonstration forestières (Cameroun)');
  console.log('----------------------------------------------------------------');

  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  if (roles.length === 0) {
    throw new Error(
      'No roles found. Start the API once (it synchronises the RBAC catalogue) or run the migration first.',
    );
  }
  const roleIds = new Map(roles.map((role) => [role.name, role.id]));

  const conflicts = await assertNoNaturalKeyConflicts();
  if (conflicts.length > 0) {
    throw new Error(
      [
        'The database already contains non-demo records using keys this seed needs:',
        ...conflicts.map((conflict) => `  - ${conflict}`),
        'Seed into an empty database, or rename/remove those records first.',
      ].join('\n'),
    );
  }

  // Order matters: every record below points at something created above it.
  const userIds = await seedUsers(roleIds);
  await seedCompanies(userIds);
  await linkCompaniesAndUsers(userIds);
  await seedForests(userIds);
  const speciesIds = await seedSpecies(userIds);
  await seedInventories(userIds, speciesIds);
  await seedPermits(userIds);
  await seedEquipment(userIds);
  await seedActivities(userIds, speciesIds);
  await seedInspections(userIds);
  await seedViolations(userIds);
  await seedObservations(userIds);
  await seedPayments(userIds);
  await seedFieldSessions(userIds);
  await seedEvidence(userIds);
  await seedReports(userIds);
  await seedIntelligence(userIds);

  console.log('');
  for (const [kind, amount] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (amount === 0) continue;
    console.log(`  ${kind.padEnd(20)} ${String(amount).padStart(4)}`);
  }

  console.log('');
  console.log(`Demo accounts (password: ${PASSWORD})`);
  for (const user of USERS) {
    console.log(`  ${user.email.padEnd(28)} ${user.role}`);
  }
  console.log('');
  console.log('All seeded rows are flagged isDemo / carry DEMO- references.');
  console.log('Payments use the SIMULATOR provider — no Campay transaction is implied.');
  console.log('AI alerts are NEW engine signals: no human review decision was seeded.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
