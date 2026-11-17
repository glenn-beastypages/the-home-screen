import type { DB } from "./common.js";

export async function finalizeTrade(
  db: DB,
  trade: { id: string; item_ids: string[] },
  state: "completed" | "canceled",
  archived: string[] = [],
) {
  await db.query(
    `UPDATE listings SET status=CASE
       WHEN $2='traded' THEN 'traded'
       WHEN id=ANY($3::uuid[]) THEN 'archived'
       WHEN is_hidden THEN 'hidden'
       ELSE 'active' END, version=version+1, updated_at=now()
     WHERE id=ANY($1::uuid[])`,
    [trade.item_ids, state === "completed" ? "traded" : "active", archived],
  );
  await db.query("DELETE FROM reservations WHERE trade_id=$1", [trade.id]);
  await db.query(
    "UPDATE trade_offers SET state=$2, shipments=COALESCE((SELECT jsonb_object_agg(party,details - 'address') FROM jsonb_each(shipments) AS s(party,details)), '{}'::jsonb),updated_at=now() WHERE id=$1",
    [trade.id, state],
  );
}
