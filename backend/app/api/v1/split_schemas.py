from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel


class MemberInput(BaseModel):
    name: str
    email: Optional[str] = None


class GroupCreate(BaseModel):
    name: str = "Split"
    my_name: str
    members: List[Union[str, MemberInput]]


class GroupOut(BaseModel):
    id: str
    name: str
    share_code: str
    share_url: str
    members: List[dict]

    class Config:
        from_attributes = True


class SplitCreate(BaseModel):
    receipt_id: str
    paid_by: str
    mode: Literal["even", "itemized"] = "even"
    tax_mode: Literal["pro_rata", "even", "payer"] = "pro_rata"
    # member name -> [line_item_id, ...] (itemized mode only)
    assignments: Optional[Dict[str, List[str]]] = None


class SplitOut(BaseModel):
    split_id: str
    shares: Dict[str, float]


class GroupSummary(BaseModel):
    group_id: str
    group_name: str
    share_code: str
    members: list
    member_count: int
    total_spend: float
    splits: list
    suggested_settlements: list
