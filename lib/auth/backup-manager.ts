// This is an authentication address exception, not a client-side privilege grant.
// Management access is verified against Supabase Auth in the database.
export const BACKUP_MANAGER_EMAIL="prodenzel992@gmail.com"
export function isBackupManagerEmail(email:string) {
  return email.trim().toLowerCase()===BACKUP_MANAGER_EMAIL
}
