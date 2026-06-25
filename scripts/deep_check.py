#!/usr/bin/env python3
"""Check specific interaction logic bugs."""
import re

def extract_js(page):
    with open(f'/home/zyx/zyx02/frontend/{page}', 'r') as f:
        content = f.read()
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
    return '\n'.join(scripts), content

def find_func(js, name):
    patterns = [
        rf'(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{',
        rf'(?:const|let|var)\s+{re.escape(name)}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{{',
    ]
    for p in patterns:
        m = re.search(p, js, re.DOTALL)
        if m:
            start = m.start()
            brace_start = js.find('{', m.end())
            if brace_start >= 0:
                depth = 1
                i = brace_start + 1
                while depth > 0 and i < len(js):
                    if js[i] == '{': depth += 1
                    elif js[i] == '}': depth -= 1
                    i += 1
                result = js[start:i]
                return result
    return None

checks = {
    'dashboard.html': ['submitCommunityProposal', 'buyCEAT', 'addVoteRow', 'loadUserBalance', 'loadAuditTeamsUser'],
    'audit-team.html': ['submitTeamReport', 'proposeVeto', 'confirmVeto', 'claimProposal', 'loadAvailableProposals'],
    'admin.html': ['submitProposal', 'startVoting', 'finalizeVoting', 'registerAuditTeam', 'transferOwnership'],
    'dispute-committee.html': ['committeeVote', 'viewCommitteeVotes'],
}

for page, funcs in checks.items():
    print(f"\n{'='*55}")
    print(f"📄 {page}")
    print(f"{'='*55}")
    js, _ = extract_js(page)
    
    for fname in funcs:
        code = find_func(js, fname)
        if not code:
            print(f"\n❌ {fname}: 函数未找到!")
            continue
        
        print(f"\n▶ {fname}")
        
        # Check error handling
        has_try = 'try' in code
        has_catch = 'catch' in code
        errors_ok = '✓' if has_try and has_catch else ('⚠' if has_try else '✗')
        print(f"  {errors_ok} 错误处理: try={has_try}, catch={has_catch}")
        
        # Check parameter validation
        if 'value' in code or 'trim()' in code or 'parseInt' in code or 'Number(' in code:
            print(f"  ✓ 有输入参数处理")
        
        # Check for pending/loading state
        if 'pending' in code or 'loading' in code.lower() or '提交中' in code:
            print(f"  ✓ 有加载状态提示")
        
        # Check DOM updates
        dom_writes = ['innerHTML', 'textContent', 'className', 'classList']
        for d in dom_writes:
            if d in code:
                print(f"  ✓ 有DOM反馈({d})")
                break
        
        # Extract contract/API calls
        calls = re.findall(r'(?:auditDAO|ceatToken|multisig|axios)\.\w+\(', code)
        if calls:
            print(f"  📞 调用: {', '.join(set(calls))}")
        
        # Print first 3 lines for context
        lines = [l.strip() for l in code.split('\n') if l.strip()][:3]
        for l in lines:
            if len(l) > 80:
                l = l[:77] + '...'
            print(f"    {l}")
