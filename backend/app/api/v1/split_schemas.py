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
    is_owner: bool = True

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
    currency: str = "USD"
    is_owner: bool = False
    me: Optional[str] = None
    members: list
    member_count: int
    total_spend: float
    splits: list
    suggested_settlements: list
    settlements: list = []


class PayHandles(BaseModel):
    venmo: Optional[str] = None
    paypal: Optional[str] = None
    cashapp: Optional[str] = None
    zelle: Optional[str] = None


class MemberAdd(BaseModel):
    name: str
    email: Optional[str] = None


class SettlementCreate(BaseModel):
    from_member_id: str
    to_member_id: str
    amount: float
    method: Literal["venmo", "paypal", "cashapp", "zelle", "cash", "other"] = "other"


class JoinRequest(BaseModel):
    # The person on the tab you are; leave empty to join as someone new.
    member_id: Optional[str] = None


class SplitPreview(BaseModel):
    receipt_id: str
    members: List[str]
    paid_by: str
    mode: Literal["even", "itemized"] = "even"
    tax_mode: Literal["pro_rata", "even", "payer"] = "pro_rata"
    assignments: Optional[Dict[str, List[str]]] = None
