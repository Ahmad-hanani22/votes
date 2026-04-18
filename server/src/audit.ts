import { db } from "./db.js";

export function logAudit(
  userId: number,
  action: string,
  entity: string,
  entityId: string | number | null,
  details?: Record<string, unknown>
) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
     VALUES (?,?,?,?,?)`
  ).run(
    userId,
    action,
    entity,
    entityId === null || entityId === undefined ? null : String(entityId),
    details ? JSON.stringify(details) : null
  );
}
