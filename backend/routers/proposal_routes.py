from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

import models, schemas
from database import get_db
from contract_utils import (
    w3,
    audit_dao_contract,
    validate_hex_hash,
    PROPOSAL_STATUS_MAP,
    PROPOSAL_STATUS_CN,
    RISK_LEVEL_MAP,
    create_proposal_on_chain,
    start_voting_on_chain,
    finalize_voting_on_chain,
    allocate_rewards_on_chain,
    slash_stake_on_chain,
    apply_vote_rewards_on_chain,
    start_community_review_on_chain,
    transfer_ownership_on_chain,
)

router = APIRouter(prefix="/api", tags=["proposals"])


@router.post("/admin/create-proposal", response_model=schemas.ProposalResponse)
def create_proposal(req: schemas.CreateProposalRequest, db: Session = Depends(get_db)):
    try:
        code_hash_bytes = validate_hex_hash(req.code_hash, "code hash")

        # 读取当前下一个 proposal_id（创建前的值）
        current_next_id = audit_dao_contract.functions.nextProposalId().call()

        # 同步创建链上提案，等待确认
        receipt = create_proposal_on_chain(code_hash_bytes)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="链上交易失败(revert)")

        # 交易成功，proposal_id = 创建前的 nextProposalId
        proposal_id = current_next_id

        # 标准化 code_hash：确保带 0x 前缀
        normalized_hash = req.code_hash if req.code_hash.startswith("0x") else "0x" + req.code_hash

        db_proposal = models.Proposal(
            proposal_id=proposal_id,
            code_hash=normalized_hash,
            status="Submitted",
            description=req.description or "",
            created_at=datetime.now(timezone.utc)
        )
        db.add(db_proposal)
        db.commit()

        return {"proposal_id": proposal_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/start-voting")
def start_voting(req: schemas.AdminActionRequest, db: Session = Depends(get_db)):
    try:
        receipt = start_voting_on_chain(req.proposal_id)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="开启投票失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/start-community-review")
def start_community_review(req: schemas.AdminActionRequest, db: Session = Depends(get_db)):
    """将提案推进到 CommunityReview 状态（前置：需先提交审计团队报告）"""
    try:
        receipt = start_community_review_on_chain(req.proposal_id)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="开启社区审核失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/finalize-voting")
def finalize_voting(req: schemas.AdminActionRequest, db: Session = Depends(get_db)):
    try:
        receipt = finalize_voting_on_chain(req.proposal_id)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="结束投票失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/allocate-rewards")
def allocate_rewards(req: schemas.AllocateRewardsRequest, db: Session = Depends(get_db)):
    try:
        amount_wei = int(req.amount)
        receipt = allocate_rewards_on_chain(req.recipient, amount_wei)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="分配奖励失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/slash-stake")
def slash_stake(req: schemas.SlashStakeRequest, db: Session = Depends(get_db)):
    try:
        amount_wei = int(req.amount)
        receipt = slash_stake_on_chain(req.staker, amount_wei)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="罚没质押失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/apply-vote-rewards")
def apply_vote_rewards(req: schemas.ApplyVoteRewardsRequest, db: Session = Depends(get_db)):
    try:
        final_hash_bytes = validate_hex_hash(req.final_hash, "final hash")
        receipt = apply_vote_rewards_on_chain(req.proposal_id, final_hash_bytes)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="应用投票奖惩失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/transfer-ownership")
def transfer_ownership(req: schemas.TransferOwnershipRequest, db: Session = Depends(get_db)):
    try:
        receipt = transfer_ownership_on_chain(req.new_owner)
        if receipt.status != 1:
            raise HTTPException(status_code=500, detail="转移所有权失败(revert)")
        return {"status": "success", "tx_hash": receipt.transactionHash.hex(), "new_owner": req.new_owner}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/proposals", response_model=List[schemas.ProposalBase])
def get_proposals(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    proposals = db.query(models.Proposal).offset(skip).limit(limit).all()
    return proposals


@router.get("/proposals/{proposal_id}", response_model=schemas.ProposalDetail)
def get_proposal(proposal_id: int, db: Session = Depends(get_db)):
    proposal = db.query(models.Proposal).filter(models.Proposal.proposal_id == proposal_id).first()
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return proposal


@router.get("/admin/unpublished-proposals", response_model=List[schemas.ProposalBase])
def get_unpublished_proposals(db: Session = Depends(get_db)):
    unpublished_proposals = db.query(models.Proposal).filter(
        models.Proposal.status == "Draft"
    ).all()
    return unpublished_proposals


@router.get("/audit-team/available-proposals", response_model=List[schemas.ProposalBase])
def get_available_proposals(db: Session = Depends(get_db)):
    available_proposals = db.query(models.Proposal).filter(
        models.Proposal.status == "Submitted"
    ).all()
    return available_proposals


@router.get("/audit-team/all-proposals", response_model=List[schemas.ProposalBase])
def get_all_proposals_for_audit_team(db: Session = Depends(get_db)):
    try:
        all_proposals = db.query(models.Proposal).all()
        return all_proposals
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/audit-team/claim-proposal")
def claim_proposal(req: schemas.ClaimProposalRequest, db: Session = Depends(get_db)):
    db_proposal = db.query(models.Proposal).filter(
        models.Proposal.proposal_id == req.proposal_id
    ).first()

    if not db_proposal:
        raise HTTPException(status_code=404, detail="提案不存在")

    if db_proposal.status != "Submitted":
        raise HTTPException(status_code=400, detail="该提案当前状态不允许接取")

    db_proposal.status = "TeamReview"
    db.commit()
    db.refresh(db_proposal)

    return {"status": "success", "proposal_id": req.proposal_id, "new_status": "TeamReview"}


@router.get("/proposals/{proposal_id}/full-info")
def get_proposal_full_info(proposal_id: int, db: Session = Depends(get_db)):
    try:
        on_chain_proposal = audit_dao_contract.functions.getProposalSummary(proposal_id).call()
        db_proposal = db.query(models.Proposal).filter(models.Proposal.proposal_id == proposal_id).first()

        code_hash = "0x" + on_chain_proposal[1].hex() if on_chain_proposal[1] != b'\x00' * 32 else "空"
        audit_hash = on_chain_proposal[2]
        audit_hash_str = "0x" + audit_hash.hex() if audit_hash != b'\x00' * 32 else "尚未提交"
        winning_hash = on_chain_proposal[3]
        winning_hash_str = "0x" + winning_hash.hex() if winning_hash != b'\x00' * 32 else "尚未确定"
        second_hash = on_chain_proposal[4]
        second_hash_str = "0x" + second_hash.hex() if second_hash != b'\x00' * 32 else "尚未提交"

        community_proposals = []
        try:
            hashes = audit_dao_contract.functions.getCommunityProposalHashes(proposal_id).call()
            for h in hashes:
                v = audit_dao_contract.functions.getCommunityProposalVotes(proposal_id, h).call()
                votes_ceat = v / (10**18)
                votes_count = votes_ceat / 100
                community_proposals.append({
                    "方案哈希": "0x" + h.hex(),
                    "得票数(质押权重)": str(int(votes_count))
                })
        except Exception:
            pass

        status_idx = on_chain_proposal[5]
        risk_idx = on_chain_proposal[6]

        result = {
            "提案ID": on_chain_proposal[0],
            "代码哈希(codeHash)": code_hash,
            "审计团队报告哈希": audit_hash_str,
            "获胜社区方案哈希": winning_hash_str,
            "二次审核修订哈希": second_hash_str,
            "状态": PROPOSAL_STATUS_MAP[status_idx] if status_idx < len(PROPOSAL_STATUS_MAP) else str(status_idx),
            "状态(中文)": PROPOSAL_STATUS_CN[status_idx] if status_idx < len(PROPOSAL_STATUS_CN) else "未知",
            "风险等级": RISK_LEVEL_MAP[risk_idx] if risk_idx < len(RISK_LEVEL_MAP) else str(risk_idx),
            "创建时间": on_chain_proposal[7],
            "创建时间(可读)": datetime.fromtimestamp(on_chain_proposal[7], tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC') if on_chain_proposal[7] > 0 else "无",
            "争议创建时间": on_chain_proposal[8],
            "已申请仲裁": on_chain_proposal[9],
            "社区方案总数": len(community_proposals),
            "社区方案详情": community_proposals,
            "链下描述": getattr(db_proposal, 'description', None) if db_proposal else None,
            "AI筛查报告": getattr(db_proposal, 'ai_screening_report', None) if db_proposal else None
        }
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/reset-db")
def reset_database(db: Session = Depends(get_db)):
    """清空所有数据库表数据，用于本地测试环境重置。仅在非生产环境使用。"""
    try:
        models.Base.metadata.drop_all(bind=db.get_bind())
        models.Base.metadata.create_all(bind=db.get_bind())
        return {"status": "success", "message": "数据库已重置，所有表已重建"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
