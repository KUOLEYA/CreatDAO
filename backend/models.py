from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Float, Text
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime, timezone
import uuid

def _utcnow():
    return datetime.now(timezone.utc)

def _gen_order_id():
    return f"AUD-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"

class Proposal(Base):
    __tablename__ = "proposals"

    id = Column(Integer, primary_key=True, index=True)
    proposal_id = Column(Integer, unique=True, index=True) # On-chain ID
    code_hash = Column(String)
    audit_report_hash = Column(String)
    status = Column(String) # AIPassed, ManualAuditing, Voting, Disputed, Finalized
    created_at = Column(DateTime, default=_utcnow)
    voting_end_time = Column(DateTime)
    winning_hash = Column(String)
    description = Column(String, nullable=True)
    ai_screening_report = Column(String, nullable=True)

    votes = relationship("Vote", back_populates="proposal")

class UserStake(Base):
    __tablename__ = "user_stakes"

    address = Column(String, primary_key=True, index=True)
    balance = Column(String) # Store as string to handle large numbers (Wei)
    rewards = Column(String) # Store as string to handle large numbers (Wei)

class Vote(Base):
    __tablename__ = "votes"

    id = Column(Integer, primary_key=True, index=True)
    proposal_id = Column(Integer, ForeignKey("proposals.proposal_id"))
    voter_address = Column(String)
    voted_hash = Column(String)
    weight = Column(String) # Voting weight at the time of vote

    proposal = relationship("Proposal", back_populates="votes")

class SyncState(Base):
    __tablename__ = "sync_state"

    id = Column(Integer, primary_key=True)
    last_synced_block = Column(Integer, default=0)

class AuditReport(Base):
    __tablename__ = "audit_reports"

    id = Column(Integer, primary_key=True, index=True)
    code_hash = Column(String, index=True, unique=True)  # Unique hash for the audit
    contract_address = Column(String, nullable=True)
    project_name = Column(String, nullable=True)
    business_logic = Column(String, nullable=True)
    audit_scope = Column(String, nullable=True)
    known_risks = Column(String, nullable=True)
    contact = Column(String, nullable=True)
    expected_completion_date = Column(String, nullable=True)
    max_completion_days = Column(String, nullable=True)
    need_task_reward = Column(String, nullable=True)
    ai_report = Column(String)  # JSON string of the report
    created_at = Column(DateTime, default=_utcnow)

class AuditOrder(Base):
    __tablename__ = "audit_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String, unique=True, index=True, default=_gen_order_id)
    tier = Column(String, index=True)
    project_name = Column(String)
    complexity = Column(String, default="moderate")
    asset_pool_size = Column(String, default="small")
    code_lines = Column(Integer, default=1000)
    contract_count = Column(Integer, default=1)
    need_bounty = Column(Boolean, default=False)
    bounty_amount = Column(Float, default=0.0)
    has_dispute = Column(Boolean, default=False)
    pay_with_token = Column(Boolean, default=False)
    wallet_address = Column(String, nullable=True)
    base_price = Column(Float, default=0.0)
    adjusted_base_fee = Column(Float, default=0.0)
    bounty_commission_pct = Column(Integer, default=0)
    bounty_commission_amount = Column(Float, default=0.0)
    arbitration_deposit = Column(Float, default=0.0)
    committee_fee = Column(Float, default=0.0)
    token_discount_pct = Column(Integer, default=0)
    token_discount_amount = Column(Float, default=0.0)
    staking_discount_pct = Column(Integer, default=0)
    staking_discount_amount = Column(Float, default=0.0)
    total_before_discount = Column(Float, default=0.0)
    total_after_discount = Column(Float, default=0.0)
    audit_earn_return = Column(Float, default=0.0)
    final_payable = Column(Float, default=0.0)
    status = Column(String, default="Pending")
    payment_status = Column(String, default="Unpaid")
    tx_hash = Column(String, nullable=True)
    payment_proof = Column(String, nullable=True)
    code_hash = Column(String, nullable=True)
    proposal_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=True, default="")
    contact = Column(String, nullable=True, default="")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ReportContent(Base):
    __tablename__ = "report_contents"

    id = Column(Integer, primary_key=True, index=True)
    report_hash = Column(String, index=True, unique=True)
    party = Column(String, index=True)
    proposal_id = Column(Integer, nullable=True, index=True)
    code_hash = Column(String, nullable=True)
    content = Column(Text)
    submitter_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class CommunityReport(Base):
    __tablename__ = "community_reports"

    id = Column(Integer, primary_key=True, index=True)
    proposal_id = Column(Integer, index=True, nullable=False)
    report_hash = Column(String, index=True)
    submitter_address = Column(String, nullable=True)
    snapshot_block_height = Column(String, nullable=True)
    consensus_proof = Column(Text, nullable=True)
    contributors = Column(Text, nullable=True)
    alignment_statement = Column(Text, nullable=True)
    signatures = Column(Text, nullable=True)
    status = Column(String, default="Draft")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
