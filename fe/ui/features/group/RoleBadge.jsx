import { GROUP_ROLE } from '../../app/config/constants.js';

const ROLE_META = {
  [GROUP_ROLE.OWNER]: { label: '👑 Trưởng nhóm', cls: 'bg-yellow-400/25 text-yellow-700 dark:text-yellow-300' },
  [GROUP_ROLE.ADMIN]: { label: '⭐ Phó nhóm', cls: 'bg-success/20 text-success' },
  [GROUP_ROLE.MEMBER]: { label: '👤 Thành viên', cls: 'bg-muted/20 text-muted' },
};

/** Badge vai trò trong nhóm: vàng (owner) / xanh lá (admin) / xám (member). */
export default function RoleBadge({ role }) {
  const meta = ROLE_META[role] || ROLE_META[GROUP_ROLE.MEMBER];
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}
