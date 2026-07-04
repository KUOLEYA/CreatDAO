from fastapi import APIRouter, HTTPException, Query
from typing import List

import contract_utils, schemas

router = APIRouter(prefix="/api", tags=["contract"])


@router.get("/contract/roles")
def get_contract_roles(address: str = Query(None)):
    result = {
        "audit_dao_address": contract_utils.AUDIT_DAO_ADDRESS,
        "ceat_token_address": contract_utils.CEAT_TOKEN_ADDRESS,
        "owner": None,
        "audit_team": None,
        "committee_members": [],
        "source": "unknown"
    }
    try:
        w3 = contract_utils.w3
        contract = contract_utils.audit_dao_contract
        result["owner"] = contract.functions.owner().call()
        result["audit_team"] = contract.functions.auditTeam().call()
        result["source"] = "chain"
        try:
            result["committee_members"] = contract.functions.getCommitteeMembers().call()
        except Exception:
            pass
        if address and result["committee_members"] and w3.is_address(address):
            checksum = w3.to_checksum_address(address)
            result["is_committee"] = any(
                m and m.lower() == checksum.lower()
                for m in result["committee_members"]
            )
    except Exception as e:
        result["source"] = "fallback"
        result["error"] = str(e)
    return result


@router.get("/contract-addresses")
def get_contract_addresses(chain_id: int = Query(None, description="链ID: 31337(本地) 或 11155111(Sepolia)")):
    if chain_id and chain_id in contract_utils.NETWORK_ADDRESSES:
        addrs = contract_utils.NETWORK_ADDRESSES[chain_id]
        return {
            "chain_id": chain_id,
            "network_name": addrs["NETWORK_NAME"],
            "audit_dao_address": addrs["AUDIT_DAO_ADDRESS"],
            "ceat_token_address": addrs["CEAT_TOKEN_ADDRESS"],
            "team_manager_address": addrs["TEAM_MANAGER_ADDRESS"],
        }
    # 无 chain_id 时返回所有可用网络
    return {
        "chain_id": None,
        "networks": {
            str(cid): {
                "network_name": info["NETWORK_NAME"],
                "audit_dao_address": info["AUDIT_DAO_ADDRESS"],
                "ceat_token_address": info["CEAT_TOKEN_ADDRESS"],
                "team_manager_address": info["TEAM_MANAGER_ADDRESS"],
            }
            for cid, info in contract_utils.NETWORK_ADDRESSES.items()
        },
        # 兼容旧版前端：返回默认（活跃网络）地址
        "audit_dao_address": contract_utils.AUDIT_DAO_ADDRESS,
        "ceat_token_address": contract_utils.CEAT_TOKEN_ADDRESS,
        "team_manager_address": contract_utils.TEAM_MANAGER_ADDRESS,
    }


@router.get("/committee/members", response_model=List[schemas.CommitteeMemberInfo])
def get_committee_members():
    try:
        members = contract_utils.audit_dao_contract.functions.getCommitteeMembers().call()
        result = []
        for member in members:
            if member == "0x" + "0" * 40:
                continue
            try:
                info = contract_utils.audit_dao_contract.functions.getStakerInfo(member).call()
                result.append({
                    "address": member,
                    "balance": str(info[0]),
                    "rewards": str(info[1]),
                    "contributionPoints": str(info[2]),
                    "reputationScore": str(info[3])
                })
            except Exception:
                result.append({
                    "address": member,
                    "balance": "0",
                    "rewards": "0",
                    "contributionPoints": "0",
                    "reputationScore": "0"
                })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
