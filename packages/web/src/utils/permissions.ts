type Role = 'superadmin' | 'admin' | 'operator' | 'member' | 'viewer';

const ROLE_LEVEL: Record<Role, number> = {
  superadmin: 4,
  admin: 3,
  operator: 2,
  member: 1,
  viewer: 0,
};

function hasMinRole(userRole: Role | undefined, minRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

export const permissions = {
  canViewConnect: (role?: Role) => hasMinRole(role, 'member'),
  canImport: (role?: Role) => hasMinRole(role, 'member'),
  canExport: (role?: Role) => hasMinRole(role, 'operator'),

  canCreateCampaign: (role?: Role) => hasMinRole(role, 'operator'),
  canEditCampaign: (role?: Role) => hasMinRole(role, 'operator'),
  canRunCampaign: (role?: Role) => hasMinRole(role, 'member'),

  canEditFunnelConfig: (role?: Role) => hasMinRole(role, 'operator'),
  canEditSchedule: (role?: Role) => hasMinRole(role, 'operator'),
  canEditExclusions: (role?: Role) => hasMinRole(role, 'operator'),

  canAccessSettings: (role?: Role) => hasMinRole(role, 'admin'),
  canManageUsers: (role?: Role) => hasMinRole(role, 'admin'),

  canViewCustomers: (role?: Role) => hasMinRole(role, 'viewer'),
  canEditCustomers: (role?: Role) => hasMinRole(role, 'operator'),
  canRunResearch: (role?: Role) => hasMinRole(role, 'member'),
  canViewActivity: (role?: Role) => hasMinRole(role, 'operator'),
  canBulkResearch: (role?: Role) => hasMinRole(role, 'operator'),
};
