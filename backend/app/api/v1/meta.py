"""Static reference data the frontend needs to render consistently."""

from fastapi import APIRouter

from app.services.categories import CATEGORY_META

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/categories")
def list_categories():
    """Every category with its display label, icon name and colour.

    No auth: it is the same for everyone and contains no user data. The
    frontend reads this instead of hard-coding the list, so a new category
    only ever has to be added in one place.
    """
    return [dict(c) for c in CATEGORY_META]
