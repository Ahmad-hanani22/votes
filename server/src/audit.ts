import { queryOne } from "./db.js";

export async function logAudit(
  userId: number,
  action: string,
  entity: string,
  entityId: string | number | null,
  details?: Record<string, unknown>
) {
  try {
    await queryOne(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        action,
        entity,
        entityId === null || entityId === undefined ? null : String(entityId),
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error("audit log error:", err);
  }
}
