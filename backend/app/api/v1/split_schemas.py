from typing import Dict, List, Optional

from pydantic import BaseModel


class GroupCreate(BaseModel):
    name: str = "Split"
    my_name: str
    members: List[str]


class GroupOut(BaseModel):
    id: str
    name: str
    share_code: str
    share_url: str
    members: List[str]

    class Config:
        from_attributes = True


class SplitCreate(BaseModel):
    receipt_id: str
    paid_by: str
    mode: str = "even"  # even | itemized
    # member name -> [line_item_id, ...] (itemized mode only)
    assignments: Optional[Dict[str, List[str]]] = None


class SplitOut(BaseModel):
    split_id: str
    shares: Dict[str, float]


class GroupSummary(BaseModel):
    group_id: str
    member_count: int
    total_spend: float
    splits: list
    suggested_settlements: list
