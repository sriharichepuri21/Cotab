from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LineItemOut(BaseModel):
    id: str
    description: str
    quantity: float
    unit_price: float
    total_price: float

    class Config:
        from_attributes = True


class ReceiptOut(BaseModel):
    id: str
    merchant: str
    merchant_raw: str
    purchased_at: Optional[datetime]
    total: float
    subtotal: float
    tax: float
    currency: str
    category: str
    status: str
    confidence: float
    error_message: str
    extraction_method: str = "gemini"  # "ocr" (rules) | "gemini" (LLM)
    source: str = "photo"  # photo | pdf | tap | email
    created_at: datetime
    line_items: List[LineItemOut] = []

    class Config:
        from_attributes = True


class LineItemCorrection(BaseModel):
    id: Optional[str] = None
    description: str
    quantity: float = 1
    unit_price: float = 0
    total_price: float = 0


class ReceiptReview(BaseModel):
    """Human-in-the-loop corrections after AI extraction."""

    merchant: Optional[str] = None
    purchased_at: Optional[datetime] = None
    total: Optional[float] = None
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    currency: Optional[str] = None
    category: Optional[str] = None
    line_items: Optional[List[LineItemCorrection]] = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)


class ChatProposalOut(BaseModel):
    id: str
    tool_name: str
    summary: str
    payload: Dict[str, Any]
    status: str
    expires_at: datetime


class ChatToolTraceOut(BaseModel):
    tool: str
    arguments: Dict[str, Any]
    result_summary: str
    data: Dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    session_id: str
    message: str
    sql: Optional[str] = None
    reformulated: Optional[str] = None
    explanation: List[ChatToolTraceOut] = Field(default_factory=list)
    proposal: Optional[ChatProposalOut] = None


class ExportResponse(BaseModel):
    id: str
    status: str
    download_url: Optional[str] = None
    expires_at: Optional[datetime] = None


class SplitGroupCreate(BaseModel):
    name: str = "Split"
    member_names: List[str]


class SplitGroupOut(BaseModel):
    id: str
    name: str
    share_code: str
    members: List[dict] = []

    class Config:
        from_attributes = True
