#!/usr/bin/env python3
"""Analyze frontend page functions and interactions."""
import re

for page in ['home.html', 'index02.html', 'index03.html', 'index04.html']:
    with open(f'/home/zyx/zyx02/frontend/{page}', 'r') as f:
        content = f.read()
    
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
    all_js = '\n'.join(scripts)
    
    # Function declarations
    funcs = re.findall(r'(?:async\s+)?function\s+(\w+)\s*\(', all_js)
    # onclick in HTML
    html_onclick = re.findall(r'onclick=["\'](\w+)', content)
    # getElementById calls to find all DOM elements used
    dom_ids = re.findall(r'getElementById\(["\'](\w+)', all_js)
    
    print(f"\n{'='*50}")
    print(f"📄 {page}")
    print(f"{'='*50}")
    print(f"定义的函数 ({len(funcs)}): {', '.join(funcs)}")
    print(f"HTML onclick ({len(html_onclick)}): {', '.join(html_onclick)}")
    print(f"DOM ID引用 ({len(set(dom_ids))}): {', '.join(sorted(set(dom_ids)))[:200]}")
    
    # Check for unused onclick handlers
    html_set = set(html_onclick)
    func_set = set(funcs)
    missing = html_set - func_set
    if missing:
        print(f"❌ HTML调用了但未定义的函数: {missing}")
    redundant = func_set - html_set - {'handleError', 'initWalletWithAccount', 'connectWallet', 'disconnectWallet', 'showError', 'msg'}
    if redundant:
        print(f"⚠️ 定义了但HTML未直接调用的函数: {redundant}")
    
    # Count API calls
    axios_calls = len(re.findall(r'axios\.(get|post|put|delete)', all_js))
    contract_calls = len(re.findall(r'(?:auditDAO|ceatToken|multisig)\.\w+\(', all_js))
    print(f"API调用数: {axios_calls}, 合约调用数: {contract_calls}")
    print()
