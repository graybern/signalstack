import { getDb } from '../db/schema.js';
import type { UserRole } from '../types/index.js';

export interface PermissionDef {
  label: string;
  category: string;
  description: string;
}

export const PERMISSIONS: Record<string, PermissionDef> = {
  'campaigns:read':    { label: 'View Campaigns',     category: 'Campaigns',   description: 'View campaign list and details' },
  'campaigns:write':   { label: 'Edit Campaigns',     category: 'Campaigns',   description: 'Create, edit, and delete campaigns' },
  'campaigns:run':     { label: 'Run Campaigns',      category: 'Campaigns',   description: 'Execute pipeline runs' },

  'leads:read':        { label: 'View Leads',         category: 'Leads',       description: 'View leads, briefs, and scores' },
  'leads:write':       { label: 'Edit Leads',         category: 'Leads',       description: 'Import and edit leads' },
  'leads:export':      { label: 'Export Leads',       category: 'Leads',       description: 'Export lead data to CSV' },
  'leads:feedback':    { label: 'Provide Feedback',   category: 'Leads',       description: 'Submit lead feedback verdicts' },

  'runs:read':         { label: 'View Runs',          category: 'Runs',        description: 'View run history and details' },
  'runs:delete':       { label: 'Delete Runs',        category: 'Runs',        description: 'Delete run records and their leads' },

  'settings:read':     { label: 'View Settings',      category: 'Settings',    description: 'View organization settings' },
  'settings:write':    { label: 'Edit Settings',      category: 'Settings',    description: 'Modify organization settings, AI config, data sources' },

  'users:read':        { label: 'View Team',          category: 'Users',       description: 'View team members and roles' },
  'users:write':       { label: 'Manage Team',        category: 'Users',       description: 'Create, edit, suspend, and remove users' },
  'users:invite':      { label: 'Send Invites',       category: 'Users',       description: 'Invite new team members' },

  'analytics:read':    { label: 'View Analytics',     category: 'Analytics',   description: 'View dashboard, charts, and reports' },

  'exclusions:read':   { label: 'View Exclusions',    category: 'Exclusions',  description: 'View exclusion lists' },
  'exclusions:write':  { label: 'Edit Exclusions',    category: 'Exclusions',  description: 'Manage exclusion lists' },

  'icp:read':          { label: 'View ICP',           category: 'ICP',         description: 'View ICP configuration and defaults' },
  'icp:write':         { label: 'Edit ICP',           category: 'ICP',         description: 'Modify ICP scoring and targeting settings' },

  'webhooks:read':     { label: 'View Webhooks',      category: 'Webhooks',    description: 'View webhook configurations' },
  'webhooks:write':    { label: 'Edit Webhooks',      category: 'Webhooks',    description: 'Create, edit, and delete webhooks' },

  'api_keys:manage':   { label: 'Manage API Keys',    category: 'API Keys',    description: 'Create and revoke personal API keys' },

  'customers:read':    { label: 'View Win Book',      category: 'Win Book',    description: 'View customer profiles and knowledge base' },
  'customers:write':   { label: 'Edit Win Book',      category: 'Win Book',    description: 'Edit customer profiles and notes' },

  'research:execute':  { label: 'Quick Research',     category: 'Research',    description: 'Run ad-hoc company research' },
  'research:bulk':     { label: 'Bulk Score-Only',    category: 'Research',    description: 'Run large score-only batches (>50 domains)' },

  'activity:read':     { label: 'View Activity Log',  category: 'Activity',    description: 'View audit trail and activity history' },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  superadmin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  operator: [
    'campaigns:read', 'campaigns:write', 'campaigns:run',
    'leads:read', 'leads:write', 'leads:export', 'leads:feedback',
    'runs:read', 'runs:delete',
    'settings:read',
    'analytics:read',
    'exclusions:read', 'exclusions:write',
    'icp:read', 'icp:write',
    'webhooks:read',
    'api_keys:manage',
    'customers:read', 'customers:write',
    'research:execute',
    'research:bulk',
    'activity:read',
  ],
  member: [
    'campaigns:read', 'campaigns:run',
    'leads:read', 'leads:feedback', 'leads:export',
    'runs:read',
    'analytics:read',
    'exclusions:read',
    'icp:read',
    'api_keys:manage',
    'customers:read',
    'research:execute',
  ],
  viewer: [
    'campaigns:read',
    'leads:read',
    'runs:read',
    'analytics:read',
    'customers:read',
  ],
};

export function seedRolePermissions(): void {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) as count FROM role_permissions').get() as any;
  if (existing.count > 0) return;

  const insert = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        insert.run(role, perm);
      }
    }
  });
  tx();
}

const NEW_PERMISSIONS = ['customers:read', 'customers:write', 'research:execute', 'research:bulk', 'activity:read'];

export function ensureNewPermissions(): void {
  const db = getDb();
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existing = new Set(getRolePermissions(role as UserRole));
    for (const perm of perms) {
      if (!existing.has(perm) && NEW_PERMISSIONS.includes(perm)) {
        db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)').run(role, perm);
      }
    }
  }
}

export function getRolePermissions(role: UserRole): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT permission FROM role_permissions WHERE role = ?').all(role) as { permission: string }[];
  if (rows.length === 0) {
    return DEFAULT_ROLE_PERMISSIONS[role] || [];
  }
  return rows.map(r => r.permission);
}

export function getUserPermissionOverrides(userId: string): { grants: string[]; revokes: string[] } {
  const db = getDb();
  const rows = db.prepare('SELECT permission, type FROM user_permission_overrides WHERE user_id = ?').all(userId) as { permission: string; type: 'grant' | 'revoke' }[];
  const grants = rows.filter(r => r.type === 'grant').map(r => r.permission);
  const revokes = rows.filter(r => r.type === 'revoke').map(r => r.permission);
  return { grants, revokes };
}

export function getEffectiveUserPermissions(role: UserRole, userId: string): string[] {
  const rolePerms = getRolePermissions(role);
  const { grants, revokes } = getUserPermissionOverrides(userId);
  const effective = new Set(rolePerms);
  for (const g of grants) effective.add(g);
  for (const r of revokes) effective.delete(r);
  return Array.from(effective);
}

export function userHasPermission(role: UserRole, permission: string, apiKeyScopes?: string[], userId?: string): boolean {
  let hasRolePerm: boolean;
  if (userId) {
    const effective = getEffectiveUserPermissions(role, userId);
    hasRolePerm = effective.includes(permission);
  } else {
    const rolePerms = getRolePermissions(role);
    hasRolePerm = rolePerms.includes(permission);
  }
  if (!hasRolePerm) return false;
  if (apiKeyScopes && !apiKeyScopes.includes(permission)) return false;
  return true;
}

export function getPermissionCategories(): { category: string; permissions: { key: string; label: string; description: string }[] }[] {
  const categories = new Map<string, { key: string; label: string; description: string }[]>();

  for (const [key, def] of Object.entries(PERMISSIONS)) {
    if (!categories.has(def.category)) categories.set(def.category, []);
    categories.get(def.category)!.push({ key, label: def.label, description: def.description });
  }

  return Array.from(categories.entries()).map(([category, permissions]) => ({ category, permissions }));
}
