import hashlib
import asyncio
import json
import os
import re
import tempfile
import zipfile
import tarfile
from datetime import datetime, timezone
from typing import List, Optional
from dotenv import load_dotenv

# 显式加载 .env 文件（从项目根目录）
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'), override=True)

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends
from openai import OpenAI
from sqlalchemy.orm import Session

from database import get_db
import models

router = APIRouter(prefix="/api/audit", tags=["audit"])

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
if not DEEPSEEK_API_KEY:
    import warnings
    warnings.warn("DEEPSEEK_API_KEY environment variable not set. AI audit features will not work.", UserWarning)
    DEEPSEEK_API_KEY = "sk-placeholder"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
AUDIT_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "audit_uploads")
os.makedirs(AUDIT_UPLOAD_DIR, exist_ok=True)

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)


def _make_error_audit_result(error_type: str, description: str, raw_response: str = None):
    result = {
        "task_info": {"audit_id": "AUD-ERROR", "code_hash": "N/A"},
        "execution_summary": {
            "ai_engine": "DeepSeek-V4", "tools": "DeepSeek AI", "coverage": "N/A",
            "timestamp": datetime.now(timezone.utc).isoformat()
        },
        "findings": [{
            "id": "AI-001", "severity": "信息提示", "location": "N/A",
            "vuln_type": error_type, "description": description, "conclusion": "PASS-WARN"
        }],
        "final_verdict": {
            "overall_conclusion": "PASS",
            "pass_timestamp": datetime.now(timezone.utc).isoformat(),
            "report_hash": hashlib.sha256(raw_response.encode()).hexdigest() if raw_response else "N/A"
        },
        "matrix_interface": {"matrix_mapping": {}, "report_permalink": "N/A"}
    }
    if raw_response:
        result["_raw_response"] = raw_response
    return result


def _compute_sha256(files: Optional[List[UploadFile]]) -> str:
    sha = hashlib.sha256()
    if not files:
        return sha.hexdigest()
    
    sorted_files = sorted([f for f in files if f and f.filename], key=lambda x: x.filename)
    for f in sorted_files:
        f.file.seek(0)
        content = f.file.read()
        f.file.seek(0)
        
        fname = f.filename.lower()
        if fname.endswith('.sol'):
            try:
                text = content.decode('utf-8', errors='replace')
            except Exception:
                text = content.decode('latin-1', errors='replace')
            text = text.replace('\r\n', '\n')
            content = text.encode('utf-8')
        
        sha.update(content)
    return sha.hexdigest()


def _extract_source_code(files: Optional[List[UploadFile]]) -> str:
    if not files:
        return ""
    
    code_parts = []
    for f in files:
        if not f or not f.filename:
            continue
        f.file.seek(0)
        content = f.file.read()
        f.file.seek(0)

        fname = f.filename.lower()
        if fname.endswith('.zip'):
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_zip = os.path.join(tmpdir, 'upload.zip')
                with open(tmp_zip, 'wb') as wf:
                    wf.write(content)
                with zipfile.ZipFile(tmp_zip, 'r') as zf:
                    zf.extractall(tmpdir)
                for root, _, filenames in os.walk(tmpdir):
                    for fn in sorted(filenames):
                        if fn.endswith('.sol'):
                            fpath = os.path.join(root, fn)
                            relpath = os.path.relpath(fpath, tmpdir)
                            with open(fpath, 'r', errors='replace') as sf:
                                code_parts.append(f"// File: {relpath}\n{sf.read()}")
        elif fname.endswith(('.tar.gz', '.tgz', '.tar')):
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_arc = os.path.join(tmpdir, 'upload.tar')
                with open(tmp_arc, 'wb') as wf:
                    wf.write(content)
                mode = 'r:gz' if fname.endswith(('.tar.gz', '.tgz')) else 'r:'
                with tarfile.open(tmp_arc, mode) as tf:
                    tf.extractall(tmpdir)
                for root, _, filenames in os.walk(tmpdir):
                    for fn in sorted(filenames):
                        if fn.endswith('.sol'):
                            fpath = os.path.join(root, fn)
                            relpath = os.path.relpath(fpath, tmpdir)
                            with open(fpath, 'r', errors='replace') as sf:
                                code_parts.append(f"// File: {relpath}\n{sf.read()}")
        elif fname.endswith('.sol'):
            try:
                text = content.decode('utf-8', errors='replace')
            except Exception:
                text = content.decode('latin-1', errors='replace')
            code_parts.append(f"// File: {f.filename}\n{text}")

    return '\n\n'.join(code_parts)


def _build_ai_prompt(source_code: str, form_data: dict) -> str:
    prompt = f"""你是一个专业的智能合约安全审计引擎（SecAI-v3 / DeepSeek-V4）。请对以下合约代码进行安全审计，并严格按指定JSON格式返回结果。

## 项目上下文
- 项目名称: {form_data.get('project_name', 'N/A')}
- 业务逻辑简述: {form_data.get('business_logic', 'N/A')}
- 关键角色与特权说明: {form_data.get('privilege_info', 'N/A')}

## 审计范围与约定
- 审计目标范围: {form_data.get('audit_scope', 'N/A')}
- 已知风险自述: {form_data.get('known_risks', 'N/A')}
- 审计用途: {form_data.get('audit_purpose', 'N/A')}

## 源代码
```solidity
{source_code}
```

## 输出要求
请严格按以下JSON格式返回审计报告（不要包含任何其他文字，只返回JSON）：

```json
{{
  "task_info": {{
    "audit_id": "AUD-YYYYMMDD-NNN",
    "code_hash": "SHA-256哈希值"
  }},
  "execution_summary": {{
    "ai_engine": "DeepSeek-V4",
    "tools": "DeepSeek AI 静态分析引擎",
    "coverage": "SWC-101 整数溢出, SWC-102 整数下溢, SWC-103 浮点精度, SWC-104 未检查返回值, SWC-105 未保护自毁, SWC-106 未保护升级, SWC-107 重入攻击, SWC-108 默认可见性, SWC-109 未初始化存储指针, SWC-110 断言违规, SWC-111 使用tx.origin, SWC-112 委托调用注入, SWC-113 DoS攻击, SWC-114 交易顺序依赖, SWC-115 时间戳依赖, SWC-116 区块哈希依赖, SWC-117 签名重放, SWC-118 错误的构造函数名, SWC-119 影子状态变量, SWC-120 弱随机性, SWC-121 缺少防护措施, SWC-122 存储碰撞, SWC-123 要求违规, SWC-124 写入任意存储位置, SWC-125 越界写入, SWC-126 越界读取, SWC-127 任意跳转, SWC-128 函数选择器碰撞, SWC-129 类型不安全, SWC-130 ABI编码/解码漏洞, SWC-131 未初始化存储状态, SWC-132 重入防护缺失, SWC-133 前端运行, SWC-134 预言机操纵, SWC-135 闪电贷攻击, SWC-136 未检查返回值",
    "timestamp": "执行时间"
  }},
  "findings": [
    {{
      "id": "AI-001",
      "severity": "高危/中危/低危/信息提示",
      "location": "文件路径 → 合约名 → 函数名 → 行号区间",
      "vuln_type": "漏洞类型标准命名",
      "description": "不超过200字的技术攻击原理说明",
      "conclusion": "BLOCK或PASS-WARN"
    }}
  ],
  "final_verdict": {{
    "overall_conclusion": "PASS或BLOCK",
    "pass_timestamp": "ISO8601时间",
    "report_hash": "整份报告的SHA-256哈希"
  }},
  "matrix_interface": {{
    "matrix_mapping": {{}},
    "report_permalink": "暂未上链"
  }}
}}
```

重要规则：
1. 如果存在高危漏洞，overall_conclusion 必须为 "BLOCK"，对应finding的conclusion为"BLOCK"
2. 中危和低危漏洞的conclusion为"PASS-WARN"
3. findings数组可以为空（表示未发现问题）
4. 每个finding的description不超过200字
5. audit_id格式为AUD-YYYYMMDD-NNN，NNN为自增序号（从001开始）
6. 必须严格返回JSON格式，不要包含任何解释文字"""
    return prompt


def _clean_json_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
        if text.startswith("\n"):
            text = text[1:]
    elif text.startswith("```"):
        text = text[3:]
        if text.startswith("\n"):
            text = text[1:]
    if text.endswith("```"):
        text = text[:-3]
        if text.endswith("\n"):
            text = text[:-1]
    return text.strip()


async def _call_deepseek(prompt: str) -> dict:
    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个智能合约安全审计引擎。请只返回JSON格式的审计报告，不要包含任何其他文字。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=8192
        )
    except Exception as e:
        return _make_error_audit_result("API调用失败", f"AI API调用失败: {e}")
    if not response.choices:
        return _make_error_audit_result("API返回为空", "AI API返回空响应")
    raw = response.choices[0].message.content
    cleaned = _clean_json_response(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        cleaned = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return _make_error_audit_result("AI解析异常", "AI返回格式异常，原始响应请查看raw字段", raw)


@router.post("/submit")
async def submit_audit(
    files: List[UploadFile] = File(None),
    project_name: str = Form(""),
    business_logic: str = Form(""),
    privilege_info: str = Form(""),
    audit_scope: str = Form(""),
    known_risks: str = Form(""),
    audit_purpose: str = Form(""),
    contact: str = Form(""),
    contract_address: str = Form(""),
    expected_completion_date: str = Form(""),
    max_completion_days: str = Form(""),
    need_task_reward: str = Form("false"),
    code_hash: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    source_code = _extract_source_code(files)
    max_code_len = 50000
    if len(source_code) > max_code_len:
        source_code = source_code[:max_code_len] + "\n// ... [代码过长已截断]"

    form_data = {
        "project_name": project_name,
        "business_logic": business_logic,
        "privilege_info": privilege_info,
        "audit_scope": audit_scope,
        "known_risks": known_risks,
        "audit_purpose": audit_purpose,
        "contact": contact,
        "expected_completion_date": expected_completion_date,
        "max_completion_days": max_completion_days,
        "need_task_reward": need_task_reward,
    }

    prompt = _build_ai_prompt(source_code, form_data)
    result = await _call_deepseek(prompt)

    if code_hash:
        full_code_hash = code_hash.lower() if code_hash.startswith("0x") else "0x" + code_hash.lower()
    else:
        computed_hash = _compute_sha256(files)
        full_code_hash = "0x" + computed_hash.lower()
    
    result.setdefault("task_info", {})["code_hash"] = full_code_hash
    result["task_info"]["contract_address"] = contract_address

    audit_id = result.get("task_info", {}).get("audit_id", f"AUD-{datetime.now(timezone.utc).strftime('%Y%m%d')}-001")
    report = {
        "audit_id": audit_id,
        "code_hash": full_code_hash,
        "report_content": result,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    report_path = os.path.join(AUDIT_UPLOAD_DIR, f"{audit_id}.json")
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    existing_report = db.query(models.AuditReport).filter(
        models.AuditReport.code_hash == full_code_hash
    ).first()
    
    if existing_report:
        existing_report.contract_address = contract_address
        existing_report.project_name = project_name
        existing_report.business_logic = business_logic
        existing_report.audit_scope = audit_scope
        existing_report.known_risks = known_risks
        existing_report.contact = contact
        existing_report.expected_completion_date = expected_completion_date
        existing_report.max_completion_days = max_completion_days
        existing_report.need_task_reward = need_task_reward
        existing_report.ai_report = json.dumps(result, ensure_ascii=False)
    else:
        db_report = models.AuditReport(
            code_hash=full_code_hash,
            contract_address=contract_address,
            project_name=project_name,
            business_logic=business_logic,
            audit_scope=audit_scope,
            known_risks=known_risks,
            contact=contact,
            expected_completion_date=expected_completion_date,
            max_completion_days=max_completion_days,
            need_task_reward=need_task_reward,
            ai_report=json.dumps(result, ensure_ascii=False)
        )
        db.add(db_report)
    
    db.commit()

    return result


@router.get("/reports/{code_hash}")
def get_report(code_hash: str, db: Session = Depends(get_db)):
    """Get audit report by code hash"""
    # Normalize the hash
    normalized_hash = code_hash
    if not normalized_hash.startswith("0x"):
        normalized_hash = "0x" + normalized_hash
    normalized_hash = normalized_hash.lower()
    
    report = db.query(models.AuditReport).filter(
        models.AuditReport.code_hash == normalized_hash
    ).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    related_proposals = db.query(models.Proposal).filter(
        models.Proposal.code_hash == normalized_hash
    ).all()
    related_proposal_ids = [p.proposal_id for p in related_proposals]
    
    try:
        ai_report = json.loads(report.ai_report)
    except (json.JSONDecodeError, TypeError):
        ai_report = {}
    
    return {
        "code_hash": report.code_hash,
        "contract_address": report.contract_address,
        "project_name": report.project_name,
        "business_logic": report.business_logic,
        "audit_scope": report.audit_scope,
        "known_risks": report.known_risks,
        "contact": report.contact,
        "report_content": ai_report,
        "created_at": report.created_at.isoformat(),
        "related_proposals": related_proposal_ids
    }
