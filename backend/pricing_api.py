from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import shutil

from database import get_db
from pricing_config import (
    PricingInput,
    calculate_pricing,
    get_all_tiers_summary,
    get_all_multipliers,
    get_discount_info,
    ServiceTier,
    ComplexityLevel,
    AssetPoolSize,
    get_staking_discount,
)
from schemas import (
    PricingCalculateRequest,
    PricingCalculateResponse,
    PricingBreakdownResponse,
    PricingTierSummary,
    PricingMultipliersResponse,
    PricingDiscountInfo,
    CreateAuditOrderRequest,
    AuditOrderResponse,
    PaymentConfirmRequest,
)
import models

router = APIRouter(prefix="/api/pricing", tags=["pricing"])


def _parse_enum(enum_cls, value, field_name):
    try:
        return enum_cls(value)
    except (ValueError, KeyError):
        valid = [e.value for e in enum_cls]
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}. Must be one of: {valid}")


@router.get("/tiers", response_model=List[PricingTierSummary])
def get_tiers():
    return get_all_tiers_summary()


@router.get("/multipliers", response_model=PricingMultipliersResponse)
def get_multipliers():
    return get_all_multipliers()


@router.get("/discounts", response_model=PricingDiscountInfo)
def get_discounts():
    return get_discount_info()


@router.post("/calculate", response_model=PricingCalculateResponse)
def calculate_price(req: PricingCalculateRequest):
    tier = _parse_enum(ServiceTier, req.tier, "tier")
    complexity = _parse_enum(ComplexityLevel, req.complexity or "moderate", "complexity")
    asset_pool_size = _parse_enum(AssetPoolSize, req.asset_pool_size or "small", "asset_pool_size")

    input_data = PricingInput(
        tier=tier,
        complexity=complexity,
        asset_pool_size=asset_pool_size,
        code_lines=req.code_lines or 1000,
        contract_count=req.contract_count or 1,
        need_bounty=req.need_bounty or False,
        bounty_amount=req.bounty_amount or 0.0,
        has_dispute=req.has_dispute or False,
        pay_with_token=req.pay_with_token or False,
        stake_amount=req.stake_amount or 0,
    )

    result = calculate_pricing(input_data)

    return {
        "tier": result.tier,
        "tier_name": result.tier_name,
        "base_price": result.base_price,
        "complexity_multiplier": result.complexity_multiplier,
        "complexity_name": result.complexity_name,
        "asset_pool_multiplier": result.asset_pool_multiplier,
        "asset_pool_name": result.asset_pool_name,
        "adjusted_base_fee": result.adjusted_base_fee,
        "bounty_fee": result.bounty_fee,
        "bounty_commission_pct": result.bounty_commission_pct,
        "bounty_commission_amount": result.bounty_commission_amount,
        "arbitration_deposit": result.arbitration_deposit,
        "committee_fee": result.committee_fee,
        "token_discount_pct": result.token_discount_pct,
        "token_discount_amount": result.token_discount_amount,
        "staking_discount_pct": result.staking_discount_pct,
        "staking_discount_amount": result.staking_discount_amount,
        "total_before_discount": result.total_before_discount,
        "total_after_discount": result.total_after_discount,
        "audit_earn_return": result.audit_earn_return,
        "final_payable": result.final_payable,
        "breakdown_text": result.breakdown_text,
    }


@router.get("/stake-discount")
def check_stake_discount(
    stake_amount: int = Query(0, description="质押代币数量"),
    address: Optional[str] = Query(None, description="钱包地址(可选,用于查询链上实际质押)"),
):
    discount_pct, tier_name, priority = get_staking_discount(stake_amount)
    return {
        "stake_amount": stake_amount,
        "tier_name": tier_name,
        "discount_pct": discount_pct,
        "priority_boost": priority,
        "wallet_address": address,
    }


@router.get("/formula")
def get_pricing_formula():
    return {
        "formula": "单次审计费用 = 基础审计费 (按档位 × 复杂度系数 × 资产池系数) + (可选赏金池 × 10%-20% 抽成) + (触发时的分歧费：仲裁押金 + 委员会启动费)",
        "discount_formula": "最终应付 = (基础费用 + 赏金抽成 + 分歧费) × (1 - 代币折扣%) × (1 - 质押折扣除%)",
        "components": {
            "base_audit_fee": "按档位、复杂度、资产池规模三要素自动计算",
            "bounty_boost": "项目方额外注资赏金池，平台抽取 10%-20% 佣金",
            "dispute_fee": "包含仲裁押金 ($2,000-$5,000) 和委员会启动费 ($500-$1,500)，仅在分歧时触发",
        },
        "discounts": {
            "token_payment": "使用 CEAT 原生代币支付享 15% 统一折扣（可配置）",
            "staking_discount": "质押越多折扣越大，最高 20% 费用减免",
            "audit_earn": "支付审计费可获 5% 平台代币返还，变客户为生态共建者",
        },
    }


@router.post("/orders", response_model=AuditOrderResponse)
def create_audit_order(req: CreateAuditOrderRequest, db: Session = Depends(get_db)):
    tier = _parse_enum(ServiceTier, req.tier, "tier")
    complexity = _parse_enum(ComplexityLevel, req.complexity or "moderate", "complexity")
    asset_pool_size = _parse_enum(AssetPoolSize, req.asset_pool_size or "small", "asset_pool_size")

    input_data = PricingInput(
        tier=tier,
        complexity=complexity,
        asset_pool_size=asset_pool_size,
        code_lines=req.code_lines or 1000,
        contract_count=req.contract_count or 1,
        need_bounty=req.need_bounty or False,
        bounty_amount=req.bounty_amount or 0.0,
        has_dispute=req.has_dispute or False,
        pay_with_token=req.pay_with_token or False,
        stake_amount=0,
    )
    result = calculate_pricing(input_data)

    order = models.AuditOrder(
        tier=req.tier,
        project_name=req.project_name,
        complexity=req.complexity or "moderate",
        asset_pool_size=req.asset_pool_size or "small",
        code_lines=req.code_lines or 1000,
        contract_count=req.contract_count or 1,
        need_bounty=req.need_bounty or False,
        bounty_amount=req.bounty_amount or 0.0,
        has_dispute=req.has_dispute or False,
        pay_with_token=req.pay_with_token or False,
        wallet_address=req.wallet_address,
        base_price=result.base_price,
        adjusted_base_fee=result.adjusted_base_fee,
        bounty_commission_pct=result.bounty_commission_pct,
        bounty_commission_amount=result.bounty_commission_amount,
        arbitration_deposit=result.arbitration_deposit,
        committee_fee=result.committee_fee,
        token_discount_pct=result.token_discount_pct,
        token_discount_amount=result.token_discount_amount,
        staking_discount_pct=result.staking_discount_pct,
        staking_discount_amount=result.staking_discount_amount,
        total_before_discount=result.total_before_discount,
        total_after_discount=result.total_after_discount,
        audit_earn_return=result.audit_earn_return,
        final_payable=result.final_payable,
        status="Pending",
        description=req.description or "",
        contact=req.contact or "",
    )

    db.add(order)
    db.commit()
    db.refresh(order)

    return order


@router.get("/orders", response_model=List[AuditOrderResponse])
def list_audit_orders(
    wallet_address: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(models.AuditOrder)
    if wallet_address:
        query = query.filter(models.AuditOrder.wallet_address == wallet_address)
    if status:
        query = query.filter(models.AuditOrder.status == status)
    orders = query.order_by(models.AuditOrder.created_at.desc()).offset(skip).limit(limit).all()
    return orders


@router.get("/orders/{order_id}", response_model=AuditOrderResponse)
def get_audit_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(models.AuditOrder).filter(models.AuditOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/orders/{order_id}/status")
def update_order_status(
    order_id: str,
    status: str = Query(..., description="New status: Pending, Confirmed, Paid, InProgress, Completed, Cancelled"),
    db: Session = Depends(get_db),
):
    valid_statuses = {"Pending", "Confirmed", "Paid", "InProgress", "Completed", "Cancelled"}
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    order = db.query(models.AuditOrder).filter(models.AuditOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    db.commit()
    db.refresh(order)
    return {"order_id": order_id, "status": status, "updated": True}


PAYMENT_PROOFS_DIR = os.path.join(os.path.dirname(__file__), "payment_proofs")
os.makedirs(PAYMENT_PROOFS_DIR, exist_ok=True)


@router.post("/orders/{order_id}/pay")
def confirm_payment(
    order_id: str,
    tx_hash: Optional[str] = Query(None),
    wallet_address: Optional[str] = Query(None),
    proof_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    order = db.query(models.AuditOrder).filter(models.AuditOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.payment_status == "Paid":
        raise HTTPException(status_code=400, detail="Order already paid")

    order.payment_status = "Paid"
    order.status = "Confirmed"
    if tx_hash:
        order.tx_hash = tx_hash
    if wallet_address:
        order.wallet_address = wallet_address

    if proof_file and proof_file.filename:
        safe_name = f"{order_id}_{proof_file.filename}"
        proof_path = os.path.join(PAYMENT_PROOFS_DIR, safe_name)
        with open(proof_path, "wb") as f:
            shutil.copyfileobj(proof_file.file, f)
        order.payment_proof = safe_name

    db.commit()
    db.refresh(order)

    return {
        "order_id": order.order_id,
        "payment_status": "Paid",
        "final_payable": order.final_payable,
        "tx_hash": order.tx_hash,
        "payment_proof": order.payment_proof,
        "message": "支付确认成功，可继续生成提案",
    }


@router.patch("/orders/{order_id}/link")
def link_order_to_proposal(
    order_id: str,
    code_hash: str = Query(...),
    proposal_id: int = Query(...),
    db: Session = Depends(get_db),
):
    order = db.query(models.AuditOrder).filter(models.AuditOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.code_hash = code_hash
    order.proposal_id = proposal_id
    order.status = "InProgress"
    db.commit()
    db.refresh(order)

    return {
        "order_id": order.order_id,
        "code_hash": code_hash,
        "proposal_id": proposal_id,
        "status": order.status,
    }


@router.get("/orders/{order_id}/payment-status")
def check_payment_status(order_id: str, db: Session = Depends(get_db)):
    order = db.query(models.AuditOrder).filter(models.AuditOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return {
        "order_id": order.order_id,
        "payment_status": order.payment_status,
        "final_payable": order.final_payable,
        "pay_with_token": order.pay_with_token,
        "proposal_id": order.proposal_id,
    }
