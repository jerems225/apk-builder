export type Role = 'OWNER' | 'MAINTAINER' | 'DEVELOPER' | 'VIEWER';

export type BuildStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  role: Role;
  roleLabel?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  workspaces: WorkspaceRef[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: Role | null;
  retentionDays: number;
  retentionInherited: boolean;
  maxConcurrent: number;
  isActive: boolean;
  webhookUrl: string;
  webhookSecretHint: string | null;
  hasWebhookSecret: boolean;
  /** Faux si keytool n'est pas installé : la génération de clé est alors masquée. */
  keytoolDisponible: boolean;
  /** Renvoyé uniquement à la création ou après régénération. */
  webhookSecret?: string;
  createdAt: string;
}

export interface Provider {
  id: string;
  label: string;
  kind: 'github' | 'gitlab' | 'gitea' | 'generic';
  host: string;
  hasToken: boolean;
  tokenHint: string | null;
  projectCount?: number;
  createdAt: string;
}

export interface Signing {
  configured: boolean;
  alias: string | null;
  fingerprint: string | null;
  uploadedAt: string | null;
  fileOnDisk: boolean;
}

export interface Project {
  id: string;
  name: string;
  repoName: string;
  repoUrl: string;
  providerId: string | null;
  provider: { id: string; label: string; kind: string } | null;
  appSubdir: string;
  gradleTask: string;
  branches: string[];
  abis: string[];
  buildTags: boolean;
  enabled: boolean;
  signing: Signing;
  buildCount?: number;
  lastBuild?: {
    id: string;
    status: BuildStatus;
    createdAt: string;
    apkSize: number | null;
    appVersion: string | null;
  };
}

export interface Build {
  id: string;
  projectId: string | null;
  projectName: string | null;
  repoName: string;
  repoUrl: string;
  ref: string;
  refType: 'branch' | 'tag';
  commitSha: string | null;
  triggeredBy: string | null;
  source: 'webhook' | 'manuel' | 'api' | 'relance';
  status: BuildStatus;
  appSubdir: string;
  gradleTask: string;
  abis: string;
  apkName: string | null;
  apkSize: number | null;
  appVersion: string | null;
  signedWith: string | null;
  exitCode: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  downloadUrl: string | null;
  signatureMatchesProject?: boolean | null;
  isActive?: boolean;
}

/** Retourné une seule fois, à la génération d'une clé côté serveur. */
export interface KeystoreGenerated extends Project {
  validUntil: string | null;
  motDePasse: string;
  magasin: { nom: string; contenuBase64: string };
  avertissement: string;
}

/** Sauvegarde d'un magasin existant, après ré-authentification. */
export interface KeystoreExport {
  nom: string;
  contenuBase64: string;
  alias: string;
  motDePasse: string;
  empreinte: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  role: Role;
  roleLabel: string;
  joinedAt: string;
  /** Retourné une seule fois, à la création du compte. */
  temporaryPassword?: string;
}

export interface RoleInfo {
  key: Role;
  label: string;
  description: string;
}

export interface ApiTokenInfo {
  id: string;
  label: string;
  tokenHint: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Retourné une seule fois, à la création. */
  token?: string;
}

export interface SeriesPoint {
  date: string;
  success: number;
  failed: number;
  total: number;
}

export interface Stats {
  period: { days: number; since: string };
  current: {
    total: number; success: number; failed: number;
    successRate: number; avgDuration: number; avgSize: number;
  };
  previous: {
    total: number; success: number; failed: number;
    successRate: number; avgDuration: number; avgSize: number;
  };
  byStatus: Record<string, number>;
  series: SeriesPoint[];
  projects: { total: number; active: number; unsigned: number };
  queue: {
    running: number; machineRunning: number;
    machineLimit: number; workspaceLimit: number;
  };
  topProjects: { projectId: string | null; repoName: string; builds: number }[];
  recent: {
    id: string; repoName: string; projectName: string | null; ref: string;
    status: BuildStatus; apkSize: number | null; appVersion: string | null;
    createdAt: string; durationSec: number | null;
  }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; avatarColor: string } | null;
}
