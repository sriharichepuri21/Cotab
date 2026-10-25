from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


class MemberInput(BaseModel):
    name: str
    email: Optional[str] = None
    # Their mobile number, typed any way; see app/services/invites.py.
    phone: Optional[str] = Field(default=None, max_length=32)
    # Picked from your list (GET /splits/people): the `ref` of that exact
    # person on another of your tabs.
    from_member: Optional[str] = Field(default=None, max_length=36)


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
    kind: str = "group"

    class Config:
        from_attributes = True


class DirectCreate(BaseModel):
    """Split straight with these people, no group name."""

    my_name: str
    members: List[MemberInput]


class SplitCreate(BaseModel):
    receipt_id: str
    paid_by: str
    mode: Literal["even", "itemized", "exact", "percent", "shares"] = "even"
    tax_mode: Literal["pro_rata", "even", "payer"] = "pro_rata"
    # member name -> [line_item_id, ...] (itemized mode only)
    assignments: Optional[Dict[str, List[str]]] = None
    # member name -> dollars (exact), percent (percent) or shares (shares);
    # people left out count as 0.
    parts: Optional[Dict[str, float]] = None
    # Redo this receipt's split on this tab instead of refusing a second one.
    replace: bool = False


class SplitOut(BaseModel):
    split_id: str
    shares: Dict[str, float]


class GroupSummary(BaseModel):
    group_id: str
    group_name: str
    kind: str = "group"
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
    phone: Optional[str] = Field(default=None, max_length=32)
    # Picked from your list (GET /splits/people): the `ref` of that exact
    # person on another of your tabs.
    from_member: Optional[str] = Field(default=None, max_length=36)


class MemberName(BaseModel):
    name: str = Field(min_length=1, max_length=255, pattern=r"\S")


class MemberPhone(BaseModel):
    phone: str = Field(min_length=1, max_length=32)


class SettlementCreate(BaseModel):
    from_member_id: str
    to_member_id: str
    amount: float
    method: Literal["venmo", "paypal", "cashapp", "zelle", "cash", "other"] = "other"


class ReminderCreate(BaseModel):
    member_id: str
    # "push": a notification on their phone that opens this tab (they need
    # Cotab with notifications on). "message": you sent it yourself (text,
    # WhatsApp...); this only notes that you reminded them.
    channel: Literal["push", "message"]


class JoinRequest(BaseModel):
    # The person on the tab you are; leave empty to join as someone new.
    member_id: Optional[str] = None


class SplitPreview(BaseModel):
    receipt_id: str
    members: List[str]
    paid_by: str
    mode: Literal["even", "itemized", "exact", "percent", "shares"] = "even"
    tax_mode: Literal["pro_rata", "even", "payer"] = "pro_rata"
    assignments: Optional[Dict[str, List[str]]] = None
    parts: Optional[Dict[str, float]] = None
