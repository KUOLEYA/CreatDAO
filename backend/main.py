from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
import uvicorn
import threading
import time
import requests as http_requests
from datetime import datetime, timedelta, timezone

import models, schemas, database, contract_utils, audit_api
from database import engine, get_db
from contract_utils import w3, audit_dao_contract, ceat_token_contract, validate_hex_hash, PROPOSAL_STATUS_MAP
from routers import proposal_routes, contract_routes, pricing_routes

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Audit DAO Business API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audit_api.router)
app.include_router(pricing_routes.router)
app.include_router(proposal_routes.router)
app.include_router(contract_routes.router)

@app.get("/")
def read_root():
    return {
        "message": "Welcome to Audit DAO Business API",
        "docs": "/docs",
        "status": "running"
    }

RPC_URLS = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org",
    "https://sepolia.gateway.tenderly.co",
    "https://1rpc.io/sepolia",
    "https://rpc2.sepolia.org",
]

@app.post("/api/rpc-proxy")
async def rpc_proxy(request: Request):
    body = await request.json()
    last_error = None
    for url in RPC_URLS:
        try:
            resp = http_requests.post(url, json=body, headers={"Content-Type": "application/json"}, timeout=10)
            return resp.json()
        except Exception as e:
            last_error = str(e)
            continue
    raise HTTPException(status_code=502, detail=f"All RPC endpoints failed: {last_error}")

@app.post("/api/dispute/committee-vote")
def committee_vote(req: schemas.CommitteeVoteRequest, db: Session = Depends(get_db)):
    try:
        contract_utils.committee_vote_async(req.proposal_id, req.support_auditor)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Business Flow APIs (For Testing) ---

@app.post("/api/test/setup-roles")
def setup_roles():
    """将管理员设置为审计团队，方便后续测试接口"""
    try:
        admin_addr = contract_utils.get_admin_account().address
        contract_utils.set_audit_team_on_chain(admin_addr)
        # 同时为 AuditDAO 授权无限额度，方便测试
        contract_utils.approve_ceat_on_chain(contract_utils.AUDIT_DAO_ADDRESS, 2**256-1)
        return {"status": "success", "audit_team": admin_addr, "msg": "Roles set and allowance granted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/test/stake")
def test_stake(req: schemas.StakeRequest):
    """管理员质押代币，以便能够提交社区方案"""
    try:
        contract_utils.stake_on_chain(int(req.amount))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/test/submit-report")
def submit_report(req: schemas.SubmitReportRequest):
    """提交审计报告（使提案进入 TeamReview 状态）"""
    try:
        report_hash_bytes = validate_hex_hash(req.report_hash, "report hash")

        try:
            on_chain_proposal = audit_dao_contract.functions.getProposalSummary(req.proposal_id).call()
            # getProposalSummary 返回: id, codeHash, auditReportHash, winningCommunityHash,
            # secondReviewHash, status, riskLevel, createdAt, disputeCreatedAt,
            # arbitrationRequested, vetoRequested, vetoApproved
            current_status = on_chain_proposal[5]  # status at index 5
            
            if on_chain_proposal[0] != req.proposal_id and req.proposal_id != 0:
                raise HTTPException(status_code=404, detail=f"Proposal {req.proposal_id} not found on chain")
                
            if current_status != 0: # 0 是 Submitted
                return {"status": "already_processed", "current_on_chain_status": current_status}
        except Exception as e:
            print(f"Read error: {e}")

        # 3. 发送交易
        contract_utils.submit_audit_report_on_chain(req.proposal_id, report_hash_bytes)
        return {"status": "success"}
    except Exception as e:
        error_msg = str(e)
        if "execution reverted" in error_msg:
            raise HTTPException(status_code=400, detail=f"Contract Revert: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Internal Error: {error_msg}")

@app.post("/api/test/submit-community-proposal")
def submit_community_proposal(req: schemas.SubmitReportRequest):
    """提交社区方案（满足开启投票的必要条件）"""
    try:
        report_hash_bytes = validate_hex_hash(req.report_hash, "report hash")
        
        try:
            on_chain_proposal = audit_dao_contract.functions.getProposalSummary(req.proposal_id).call()
            if on_chain_proposal[0] != req.proposal_id and req.proposal_id != 0:
                raise HTTPException(status_code=404, detail=f"Proposal {req.proposal_id} not found on chain")
            if on_chain_proposal[1] != b'\x00' * 32 and report_hash_bytes == on_chain_proposal[1]:
                raise HTTPException(status_code=400, detail="This hash is identical to the codeHash, cannot submit as community proposal")
        except HTTPException:
            raise
        except Exception:
            pass
        
        contract_utils.submit_community_proposal_on_chain(req.proposal_id, report_hash_bytes)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Query APIs ---

@app.get("/api/user/{address}/status", response_model=schemas.UserStatus)
def get_user_status(address: str, db: Session = Depends(get_db)):
    try:
        checksum_address = contract_utils.w3.to_checksum_address(address)
        staker_info = audit_dao_contract.functions.getStakerInfo(checksum_address).call()
        return {
            "address": checksum_address,
            "balance": str(staker_info[0]),
            "rewards": str(staker_info[1]),
            "contributionPoints": str(staker_info[2]),
            "reputationScore": str(staker_info[3]),
            "source": "chain"
        }
    except Exception as e:
        user_stake = db.query(models.UserStake).filter(models.UserStake.address == address.lower()).first()
        if not user_stake:
            return {
                "address": address,
                "balance": "0",
                "rewards": "0",
                "contributionPoints": "0",
                "reputationScore": "0",
                "source": "fallback"
            }
        return {
            "address": address,
            "balance": user_stake.balance,
            "rewards": user_stake.rewards,
            "contributionPoints": "0",
            "reputationScore": "0",
            "source": "fallback"
        }

# --- Frontend-Facing APIs ---

@app.get("/api/user/{address}/token-balance")
def get_user_token_balance(address: str):
    try:
        checksum_address = contract_utils.w3.to_checksum_address(address)
        balance = ceat_token_contract.functions.balanceOf(checksum_address).call()
        allowance = ceat_token_contract.functions.allowance(checksum_address, contract_utils.AUDIT_DAO_ADDRESS).call()
        return {
            "address": checksum_address,
            "ceat_balance": str(balance),
            "allowance": str(allowance)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/reports/save", response_model=schemas.ReportContentResponse)
def save_report_content(req: schemas.SaveReportContentRequest, db: Session = Depends(get_db)):
    clean_hash = req.report_hash.replace("0x", "")
    if not clean_hash or not all(c in "0123456789abcdefABCDEF" for c in clean_hash):
        raise HTTPException(status_code=400, detail="Invalid report hash.")
    full_hash = "0x" + clean_hash.lower()

    valid_parties = ["ai", "community", "team"]
    if req.party not in valid_parties:
        raise HTTPException(status_code=400, detail=f"Invalid party. Must be one of: {valid_parties}")

    existing = db.query(models.ReportContent).filter(
        models.ReportContent.report_hash == full_hash
    ).first()

    if existing:
        existing.party = req.party
        existing.proposal_id = req.proposal_id
        existing.code_hash = req.code_hash
        existing.content = req.content
        existing.submitter_address = req.submitter_address
    else:
        entry = models.ReportContent(
            report_hash=full_hash,
            party=req.party,
            proposal_id=req.proposal_id,
            code_hash=req.code_hash,
            content=req.content,
            submitter_address=req.submitter_address,
        )
        db.add(entry)

    db.commit()
    if existing:
        db.refresh(existing)
        return existing
    else:
        db.refresh(entry)
        return entry


@app.get("/api/reports/{report_hash}", response_model=schemas.ReportContentResponse)
def get_report_content(
    report_hash: str,
    party: Optional[str] = Query(None, description="Filter by party: ai, community, team"),
    db: Session = Depends(get_db),
):
    clean_hash = report_hash.replace("0x", "")
    if not clean_hash:
        raise HTTPException(status_code=400, detail="Invalid report hash")
    full_hash = "0x" + clean_hash.lower()

    query = db.query(models.ReportContent).filter(
        models.ReportContent.report_hash == full_hash
    )
    if party:
        query = query.filter(models.ReportContent.party == party)

    entry = query.first()
    if not entry:
        raise HTTPException(status_code=404, detail="Report not found")
    return entry


# --- Community Report APIs ---

@app.post("/api/community-report/save", response_model=schemas.CommunityReportResponse)
def save_community_report(req: schemas.CommunityReportSaveRequest, db: Session = Depends(get_db)):
    existing = db.query(models.CommunityReport).filter(
        models.CommunityReport.proposal_id == req.proposal_id,
        models.CommunityReport.submitter_address == req.submitter_address
    ).first()

    if existing:
        existing.report_hash = req.report_hash
        existing.snapshot_block_height = req.snapshot_block_height
        existing.consensus_proof = req.consensus_proof
        existing.contributors = req.contributors
        existing.alignment_statement = req.alignment_statement
        existing.signatures = req.signatures
        existing.status = req.status or "Draft"
        db.commit()
        db.refresh(existing)
        return existing
    else:
        entry = models.CommunityReport(
            proposal_id=req.proposal_id,
            report_hash=req.report_hash,
            submitter_address=req.submitter_address,
            snapshot_block_height=req.snapshot_block_height,
            consensus_proof=req.consensus_proof,
            contributors=req.contributors,
            alignment_statement=req.alignment_statement,
            signatures=req.signatures,
            status=req.status or "Draft",
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry


@app.get("/api/community-report/{proposal_id}", response_model=List[schemas.CommunityReportResponse])
def get_community_reports(proposal_id: int, db: Session = Depends(get_db)):
    reports = db.query(models.CommunityReport).filter(
        models.CommunityReport.proposal_id == proposal_id
    ).order_by(models.CommunityReport.created_at.desc()).all()
    return reports


@app.get("/api/community-report/{proposal_id}/{address}", response_model=schemas.CommunityReportResponse)
def get_community_report_by_address(proposal_id: int, address: str, db: Session = Depends(get_db)):
    report = db.query(models.CommunityReport).filter(
        models.CommunityReport.proposal_id == proposal_id,
        models.CommunityReport.submitter_address == address
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Community report not found")
    return report


@app.get("/api/reports/list/{party}", response_model=List[schemas.ReportContentListItem])
def list_reports_by_party(
    party: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    valid_parties = ["ai", "community", "team"]
    if party not in valid_parties:
        raise HTTPException(status_code=400, detail=f"Invalid party. Must be one of: {valid_parties}")

    entries = (
        db.query(models.ReportContent)
        .filter(models.ReportContent.party == party)
        .order_by(models.ReportContent.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return entries

# --- Event Listener & Background Tasks ---

def event_listener_task():
    print("Starting event listener...")
    db = next(database.get_db())
    sync_state = db.query(models.SyncState).first()
    if not sync_state:
        sync_state = models.SyncState(last_synced_block=0)
        db.add(sync_state)
        db.commit()
    last_synced_block = sync_state.last_synced_block if sync_state else 0
    db.close()

    consecutive_errors = 0
    while True:
        db = None
        try:
            db = next(database.get_db())
            if not w3.is_connected():
                print("RPC disconnected, refreshing...")
                contract_utils.refresh_web3()

            current_block = w3.eth.block_number
            if current_block > last_synced_block:
                from_block = last_synced_block + 1
                to_block = min(current_block, from_block + 5000)

                _sync_events(db, from_block, to_block)

                last_synced_block = to_block
                sync_record = db.query(models.SyncState).first()
                if sync_record:
                    sync_record.last_synced_block = last_synced_block
                else:
                    db.add(models.SyncState(last_synced_block=last_synced_block))
                db.commit()
                consecutive_errors = 0

            time.sleep(15)
        except Exception as e:
            consecutive_errors += 1
            print(f"Error in event listener ({consecutive_errors}): {e}")
            if db is not None:
                db.rollback()
            if consecutive_errors >= 3:
                print("Multiple errors, refreshing RPC connection...")
                contract_utils.refresh_web3()
                consecutive_errors = 0
            time.sleep(30)
        finally:
            if db is not None:
                db.close()


def _get_logs(contract_event_fn, from_block, to_block):
    try:
        return contract_event_fn().get_logs(from_block=from_block, to_block=to_block)
    except Exception:
        return []


def _sync_events(db, from_block, to_block):
    c = audit_dao_contract
    utcnow = datetime.now(timezone.utc)

    for ev in _get_logs(c.events.ProposalCreated, from_block, to_block):
        pid = ev['args']['proposalId']
        if not db.query(models.Proposal).filter_by(proposal_id=pid).first():
            db.add(models.Proposal(proposal_id=pid, code_hash=ev['args']['codeHash'].hex(),
                                   status="Submitted", created_at=utcnow))

    for ev in _get_logs(c.events.ProposalStatusChanged, from_block, to_block):
        p = db.query(models.Proposal).filter_by(proposal_id=ev['args']['proposalId']).first()
        if p:
            idx = ev['args']['newStatus']
            p.status = PROPOSAL_STATUS_MAP[idx] if 0 <= idx < len(PROPOSAL_STATUS_MAP) else f"Unknown({idx})"
            if p.status == "CommunityReview":
                p.voting_end_time = utcnow + timedelta(days=7)

    for ev in _get_logs(c.events.Staked, from_block, to_block):
        addr, amt = ev['args']['staker'].lower(), str(ev['args']['amount'])
        us = db.query(models.UserStake).filter_by(address=addr).first()
        if us:
            us.balance = str(int(us.balance) + int(amt))
        else:
            db.add(models.UserStake(address=addr, balance=amt, rewards="0"))

    for ev in _get_logs(c.events.Unstaked, from_block, to_block):
        us = db.query(models.UserStake).filter_by(address=ev['args']['staker'].lower()).first()
        if us:
            us.balance = str(max(0, int(us.balance) - int(ev['args']['amount'])))

    for ev in _get_logs(c.events.VoteCast, from_block, to_block):
        voter = ev['args']['voter'].lower()
        pid = ev['args']['proposalId']
        if not db.query(models.Vote).filter_by(proposal_id=pid, voter_address=voter).first():
            w = db.query(models.UserStake).filter_by(address=voter).first()
            db.add(models.Vote(proposal_id=pid, voter_address=voter,
                               voted_hash=ev['args']['votedHash'].hex(), weight=w.balance if w else "0"))

    for ev in _get_logs(c.events.RewardsClaimed, from_block, to_block):
        us = db.query(models.UserStake).filter_by(address=ev['args']['staker'].lower()).first()
        if us:
            us.rewards = str(max(0, int(us.rewards) - int(ev['args']['amount'])))

def auto_task_checker():
    print("Starting auto task checker...")
    while True:
        db = None
        try:
            db = next(database.get_db())
            # Check for expired voting
            now = datetime.now(timezone.utc)
            expired_proposals = db.query(models.Proposal).filter(
                models.Proposal.status == "CommunityReview",
                models.Proposal.voting_end_time <= now
            ).all()
            
            for p in expired_proposals:
                print(f"Finalizing voting for proposal {p.proposal_id}")
                try:
                    contract_utils.finalize_voting_on_chain(p.proposal_id)
                except Exception as e:
                    print(f"Failed to auto-finalize proposal {p.proposal_id}: {e}")
            
            time.sleep(60) # Check every minute
        except Exception as e:
            print(f"Error in auto task checker: {e}")
            time.sleep(60)
        finally:
            if db is not None:
                db.close()

@app.on_event("startup")
async def startup_event():
    # Start background threads
    threading.Thread(target=event_listener_task, daemon=True).start()
    threading.Thread(target=auto_task_checker, daemon=True).start()

if __name__ == "__main__":
    import os
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)