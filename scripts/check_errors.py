#!/usr/bin/env python3
"""Check actual error handling patterns, not just try/catch."""
import re

def extract_js(page):
    with open(f'/home/zyx/zyx02/frontend/{page}', 'r') as f:
        content = f.read()
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
    return '\n'.join(scripts), content

def find_func_body(js, name):
    patterns = [
        rf'(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{',
        rf'(?:const|let|var)\s+{re.escape(name)}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{{',
    ]
    for p in patterns:
        m = re.search(p, js, re.DOTALL)
        if m:
            brace_start = js.find('{', m.end())
            if brace_start >= 0:
                depth = 1
                i = brace_start + 1
                while depth > 0 and i < len(js):
                    if js[i] == '{': depth += 1
                    elif js[i] == '}': depth -= 1
                    i += 1
                return js[brace_start+1:i-1]
    return None

pages = ['dashboard.html', 'admin.html', 'audit-team.html', 'dispute-committee.html']

for page in pages:
    js, _ = extract_js(page)
    print(f"\n{'='*55}")
    print(f"📄 {page}")
    print(f"{'='*55}")
    
    # Find all function names in JS
    funcs = re.findall(r'(?:async\s+)?function\s+(\w+)\s*\(', js)
    
    for fname in funcs[:30]:  # Limit to first 30 funcs
        body = find_func_body(js, fname)
        if not body:
            continue
        
        # Check for error handling patterns
        has_try = 'try' in body
        has_catch = 'catch' in body
        has_handleError = 'handleError' in body or 'showError' in body
        has_catch_dot = '.catch(' in body  # Promise catch
        has_then_catch = '.then(' in body
        
        # Only show functions that have contract calls
        has_contract_call = bool(re.findall(r'(?:auditDAO|ceatToken|multisig|axios)\.\w+\(', body))
        if not has_contract_call:
            continue
        
        error_status = '✅' if (has_try and has_catch) or has_handleError or has_catch_dot else \
                      ('⚠️' if has_try else '❌')
        
        pattern = ''
        if has_try and has_catch: pattern = 'try/catch'
        elif has_handleError: pattern = 'handleError'
        elif has_catch_dot: pattern = '.catch()'
        elif has_try and not has_catch: pattern = 'try NO catch ⚠️'
        else: pattern = '无错误处理 ❌'
        
        print(f"  {error_status} {fname}: {pattern}")
