import json
import os
import time
import threading
from web3 import Web3
from dotenv import load_dotenv

# 加载根目录 .env
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'), override=True)
# 加载 backend 目录 .env（含有合约地址等配置）
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'), override=True)

from fastapi import HTTPException

PROPOSAL_STATUS_MAP = [
    "Submitted", "TeamReview", "CommunityReview", "Discussion",
    "FirstDispute", "SecondReview", "CommitteeRuling", "Arbitration",
    "Finalized",
]
PROPOSAL_STATUS_CN = [
    "已录入", "团队审核中", "社区审核中", "公开讨论",
    "争议判断", "二次复核", "委员会裁决", "独立仲裁",
    "已终结",
]
RISK_LEVEL_MAP = ["None", "Low", "Medium", "High", "Critical"]


def validate_hex_hash(raw_hash: str, label: str = "Hash") -> bytes:
    clean = raw_hash.replace("0x", "")
    if len(clean) != 64:
        raise HTTPException(status_code=400, detail=f"Invalid {label} length. Must be 64 hex characters (32 bytes).")
    if clean == "0" * 64:
        raise HTTPException(status_code=400, detail=f"{label} cannot be all zeros.")
    return bytes.fromhex(clean)


RPC_URLS = [
    os.getenv("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
]

def get_web3():
    for url in RPC_URLS:
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={'timeout': 10}))
            if w3.is_connected():
                return w3
        except Exception:
            continue
    return Web3(Web3.HTTPProvider(RPC_URLS[0]))

w3 = get_web3()
_w3_lock = threading.Lock()

def refresh_web3():
    global w3, audit_dao_contract, ceat_token_contract
    with _w3_lock:
        new_w3 = get_web3()
        if new_w3.is_connected():
            w3 = new_w3
            audit_dao_contract = w3.eth.contract(address=AUDIT_DAO_ADDRESS, abi=audit_dao_abi)
            ceat_token_contract = w3.eth.contract(address=CEAT_TOKEN_ADDRESS, abi=ceat_token_abi)

ADMIN_PRIVATE_KEY = os.getenv("ADMIN_PRIVATE_KEY")
AUDIT_DAO_ADDRESS = os.getenv("AUDIT_DAO_ADDRESS")
CEAT_TOKEN_ADDRESS = os.getenv("CEAT_TOKEN_ADDRESS")

if not AUDIT_DAO_ADDRESS:
    raise ValueError("AUDIT_DAO_ADDRESS not set in .env")
if not CEAT_TOKEN_ADDRESS:
    raise ValueError("CEAT_TOKEN_ADDRESS not set in .env")

def load_abi(file_path):
    with open(file_path, 'r') as f:
        artifact = json.load(f)
        return artifact['abi']

# Correct paths - relative to project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
AUDIT_DAO_ABI_PATH = os.path.join(PROJECT_ROOT, "artifacts", "contracts", "Governance", "AuditDAOv2.sol", "AuditDAOv2.json")
CEAT_TOKEN_ABI_PATH = os.path.join(PROJECT_ROOT, "artifacts", "contracts", "Token", "CeatToken.sol", "Ceattoken.json")

audit_dao_abi = load_abi(AUDIT_DAO_ABI_PATH)
ceat_token_abi = load_abi(CEAT_TOKEN_ABI_PATH)

audit_dao_contract = w3.eth.contract(address=AUDIT_DAO_ADDRESS, abi=audit_dao_abi)
ceat_token_contract = w3.eth.contract(address=CEAT_TOKEN_ADDRESS, abi=ceat_token_abi)

def get_admin_account():
    if not ADMIN_PRIVATE_KEY:
        raise ValueError("ADMIN_PRIVATE_KEY not set in .env")
    return w3.eth.account.from_key(ADMIN_PRIVATE_KEY)

def send_transaction(func, *args):
    global w3
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            with _w3_lock:
                if not w3.is_connected():
                    release_lock = True
                else:
                    release_lock = False
            if release_lock:
                print(f"[send_transaction] RPC disconnected, refreshing... (attempt {attempt+1}/{max_retries})")
                refresh_web3()
                with _w3_lock:
                    if not w3.is_connected():
                        raise Exception("Failed to reconnect to RPC")
            
            with _w3_lock:
                account = get_admin_account()
                nonce = w3.eth.get_transaction_count(account.address)
                block = w3.eth.get_block('latest')
                base_fee = block.get('baseFeePerGas', 0)
                max_priority = w3.to_wei(2, 'gwei')
                max_fee = max_priority + base_fee * 2

                tx = func(*args).build_transaction({
                    'from': account.address,
                    'nonce': nonce,
                    'gas': 2000000,
                    'maxFeePerGas': max_fee,
                    'maxPriorityFeePerGas': max_priority
                })

                signed_tx = w3.eth.account.sign_transaction(tx, ADMIN_PRIVATE_KEY)
                tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            return w3.eth.wait_for_transaction_receipt(tx_hash)
            
        except Exception as e:
            print(f"[send_transaction] Attempt {attempt+1} failed: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(2)
                refresh_web3()
            else:
                raise

def chain_call(contract_func, *args):
    """同步执行链上交易，等待 receipt 确认后返回。"""
    return send_transaction(contract_func, *args)


# --- Synchronous chain operations ---

def create_proposal_on_chain(code_hash_bytes):
    code_hash_bytes32 = bytes(code_hash_bytes.ljust(32, b'\x00')[:32])
    return chain_call(audit_dao_contract.functions.createProposal, code_hash_bytes32)

def start_voting_on_chain(proposal_id):
    return chain_call(audit_dao_contract.functions.startVoting, proposal_id)

def finalize_voting_on_chain(proposal_id):
    return chain_call(audit_dao_contract.functions.finalizeVoting, proposal_id)

def allocate_rewards_on_chain(recipient, amount):
    return chain_call(audit_dao_contract.functions.allocateRewards, recipient, amount)

def slash_stake_on_chain(staker, amount):
    return chain_call(audit_dao_contract.functions.slashStake, staker, amount)

def apply_vote_rewards_on_chain(proposal_id, final_hash_bytes):
    return chain_call(audit_dao_contract.functions.applyVoteRewardsPenalties, proposal_id, final_hash_bytes)

def committee_vote_on_chain(proposal_id, support_auditor):
    return chain_call(audit_dao_contract.functions.committeeVote, proposal_id, support_auditor)

def submit_audit_report_on_chain(proposal_id, report_hash_bytes):
    return chain_call(audit_dao_contract.functions.submitTeamReport, proposal_id, report_hash_bytes)

def submit_community_proposal_on_chain(proposal_id, result_hash_bytes):
    return chain_call(audit_dao_contract.functions.submitCommunityProposal, proposal_id, result_hash_bytes)

def stake_on_chain(amount):
    return chain_call(audit_dao_contract.functions.stake, amount)

def approve_ceat_on_chain(spender, amount):
    return chain_call(ceat_token_contract.functions.approve, spender, amount)

def set_audit_team_on_chain(team_address):
    return chain_call(audit_dao_contract.functions.setAuditTeam, team_address)

def start_community_review_on_chain(proposal_id):
    return chain_call(audit_dao_contract.functions.startCommunityReview, proposal_id)

def transfer_ownership_on_chain(new_owner):
    return chain_call(audit_dao_contract.functions.transferOwnership, new_owner)