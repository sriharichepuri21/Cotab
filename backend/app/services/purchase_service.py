"""Keep each receipt's purchase in step with it.

Step 1 of the redesign introduces purchases while every screen still reads
receipts. Until reads move over, every write that changes a receipt's money
fields calls `sync_from_receipt`, so the purchases table is always a faithful
copy and can be switched to without a second backfill.

A receipt with no purchase gets one with the same id, matching how the
migration wrapped existing receipts.
"""

from sqlalchemy.orm import Session

from app.models import Purchase, Receipt


def sync_from_receipt(db: Session, receipt: Receipt) -> Purchase:
    purchase = None
    if receipt.purchase_id:
        purchase = db.get(Purchase, receipt.purchase_id)
    if purchase is None:
        if receipt.id is None:
            db.flush()
        purchase = Purchase(id=receipt.id, user_id=receipt.user_id, source="photo")
        db.add(purchase)
        receipt.purchase_id = purchase.id
    purchase.merchant = receipt.merchant or ""
    purchase.total = receipt.total or 0.0
    purchase.currency = receipt.currency or "USD"
    purchase.category = receipt.category or "other"
    purchase.purchased_at = receipt.purchased_at
    purchase.deleted_at = receipt.deleted_at
    return purchase
