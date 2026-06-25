from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import datetime

class ProposalBase(BaseModel):
    proposal_id: int
    code_hash: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class ProposalDetail(ProposalBase):
    audit_report_hash: Optional[str] = None
    voting_end_time: Optional[datetime] = None
    winning_hash: Optional[str] = None

    class Config:
        from_attributes = True

class UserStatus(BaseModel):
    address: str
    balance: str
    rewards: str
    contributionPoints: Optional[str] = "0"
    reputationScore: Optional[str] = "0"
    source: Optional[str] = None

class CreateProposalRequest(BaseModel):
    code_hash: str # Hex string
    description: Optional[str] = ""

class AdminActionRequest(BaseModel):
    proposal_id: int

class ProposalResponse(BaseModel):
    proposal_id: int

class AllocateRewardsRequest(BaseModel):
    recipient: str
    amount: str # String representation of Wei

class SlashStakeRequest(BaseModel):
    staker: str
    amount: str # String representation of Wei

class CommitteeVoteRequest(BaseModel):
    proposal_id: int
    support_auditor: bool

class SubmitReportRequest(BaseModel):
    proposal_id: int
    report_hash: str

class TransferOwnershipRequest(BaseModel):
    new_owner: str

class StakeRequest(BaseModel):
    amount: str

class ClaimProposalRequest(BaseModel):
    proposal_id: int

class ApplyVoteRewardsRequest(BaseModel):
    proposal_id: int
    final_hash: str

class CommitteeMemberInfo(BaseModel):
    address: str
    balance: str
    rewards: str
    contributionPoints: str
    reputationScore: str

# --- Pricing Schemas ---

class PricingCalculateRequest(BaseModel):
    tier: str
    complexity: Optional[str] = "moderate"
    asset_pool_size: Optional[str] = "small"
    code_lines: Optional[int] = 1000
    contract_count: Optional[int] = 1
    need_bounty: Optional[bool] = False
    bounty_amount: Optional[float] = 0.0
    has_dispute: Optional[bool] = False
    pay_with_token: Optional[bool] = False
    stake_amount: Optional[int] = 0

class PricingBreakdownResponse(BaseModel):
    tier: str
    tier_name: str
    base_price: float
    complexity_multiplier: float
    complexity_name: str
    asset_pool_multiplier: float
    asset_pool_name: str
    adjusted_base_fee: float
    bounty_fee: float
    bounty_commission_pct: int
    bounty_commission_amount: float
    arbitration_deposit: float
    committee_fee: float
    token_discount_pct: int
    token_discount_amount: float
    staking_discount_pct: int
    staking_discount_amount: float
    total_before_discount: float
    total_after_discount: float
    audit_earn_return: float
    final_payable: float
    breakdown_text: dict

class PricingCalculateResponse(PricingBreakdownResponse):
    pass

class PricingTierSummary(BaseModel):
    tier: str
    name: str
    description: str
    price_range: str
    default_price: float
    includes: List[str]
    positioning: str
    icon: str
    color: str
    gradient: str

class ComplexityMultiplierItem(BaseModel):
    level: str
    name: str
    multiplier: float
    description: str

class AssetPoolMultiplierItem(BaseModel):
    size: str
    name: str
    tvl_range: str
    multiplier: float

class PricingMultipliersResponse(BaseModel):
    complexity: List[ComplexityMultiplierItem]
    asset_pool: List[AssetPoolMultiplierItem]

class StakingTierItem(BaseModel):
    min_stake: int
    name: str
    discount_pct: int
    priority: bool

class BountyCommissionInfo(BaseModel):
    min_pct: int
    max_pct: int
    default_pct: int

class DisputeFeesInfo(BaseModel):
    deposit_min: int
    deposit_max: int
    deposit_default: int
    committee_min: int
    committee_max: int
    committee_default: int

class PricingDiscountInfo(BaseModel):
    token_payment_discount_pct: int
    staking_tiers: List[StakingTierItem]
    bounty_commission: BountyCommissionInfo
    dispute_fees: DisputeFeesInfo
    audit_earn_return_pct: int

# --- Audit Order Schemas ---

class CreateAuditOrderRequest(BaseModel):
    tier: str
    project_name: str
    complexity: Optional[str] = "moderate"
    asset_pool_size: Optional[str] = "small"
    code_lines: Optional[int] = 1000
    contract_count: Optional[int] = 1
    need_bounty: Optional[bool] = False
    bounty_amount: Optional[float] = 0.0
    has_dispute: Optional[bool] = False
    pay_with_token: Optional[bool] = False
    wallet_address: Optional[str] = None
    description: Optional[str] = ""
    contact: Optional[str] = ""

class AuditOrderResponse(BaseModel):
    id: int
    order_id: str
    tier: str
    project_name: str
    status: str
    payment_status: Optional[str] = "Unpaid"
    adjusted_base_fee: float
    total_before_discount: float
    final_payable: float
    pay_with_token: bool
    wallet_address: Optional[str] = None
    tx_hash: Optional[str] = None
    proposal_id: Optional[int] = None
    code_hash: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PaymentConfirmRequest(BaseModel):
    order_id: str
    tx_hash: Optional[str] = None
    wallet_address: Optional[str] = None


class SaveReportContentRequest(BaseModel):
    report_hash: str
    party: str
    proposal_id: Optional[int] = None
    code_hash: Optional[str] = None
    content: str
    submitter_address: Optional[str] = None


class ReportContentResponse(BaseModel):
    report_hash: str
    party: str
    proposal_id: Optional[int] = None
    code_hash: Optional[str] = None
    content: str
    submitter_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ReportContentListItem(BaseModel):
    report_hash: str
    party: str
    proposal_id: Optional[int] = None
    code_hash: Optional[str] = None
    submitter_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CommunityReportContributor(BaseModel):
    address: str
    discovery_content: str
    is_first_discoverer: bool = False
    report_quality: str = ""
    has_effective_fix: bool = False
    fix_description: str = ""


class CommunityReportSaveRequest(BaseModel):
    proposal_id: int
    report_hash: str
    submitter_address: Optional[str] = None
    snapshot_block_height: Optional[str] = None
    consensus_proof: Optional[str] = None
    contributors: Optional[str] = None
    alignment_statement: Optional[str] = None
    signatures: Optional[str] = None
    status: Optional[str] = "Draft"


class CommunityReportResponse(BaseModel):
    id: int
    proposal_id: int
    report_hash: Optional[str] = None
    submitter_address: Optional[str] = None
    snapshot_block_height: Optional[str] = None
    consensus_proof: Optional[str] = None
    contributors: Optional[str] = None
    alignment_statement: Optional[str] = None
    signatures: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
