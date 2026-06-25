#!/usr/bin/env python3
"""Deep analysis of key frontend interactions."""
import re

def extract_js(page):
    with open(f'/home/zyx/zyx02/frontend/{page}', 'r') as f:
        content = f.read()
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', content, re.DOTALL)
    return '\n'.join(scripts), content

def find_func(js, name):
    """Find a function definition by name."""
    patterns = [
        rf'(?:async\s+)?function\s+{re.escape(name)}\s*\(([^)]*)\)\s*\{{',
        rf'(?:const|let|var)\s+{re.escape(name)}\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{{',
    ]
    for p in patterns:
        m = re.search(p, js)
        if m:
            # Extract the function body
            start = m.start()
            # Find matching brace
            brace_start = js.find('{', m.end())
            if brace_start >= 0:
                depth = 1
                i = brace_start + 1
                while depth > 0 and i < len(js):
                    if js[i] == '{': depth += 1
                    elif js[i] == '}': depth -= 1
                    i += 1
                return js[start:i]
            return js[start:start+200]
    return None

js, _ = extract_js('home.html')

# Analyze the connectWallet function
connect = find_func(js, 'connectWallet')
if connect:
    print("=== connectWallet ===")
    # Check for eth_chainId switching
    if 'chainId' in connect or 'chain_id' in connect or '0xaa36a7' in connect:
        print("  ✅ Has chain switching logic")
    else:
        print("  ⚠️ No chain switching found")
    if 'window.ethereum' in connect:
        print("  ✅ Has window.ethereum check")
    else:
        print("  ❌ Missing window.ethereum check")

# Analyze approveAndStake
stake = find_func(js, 'approveAndStake')
if stake:
    print("\n=== approveAndStake ===")
    lines = stake.split('\n')
    print(f"  Lines: {len(lines)}")
    # Check for allowance check before approve
    if 'allowance' in stake:
        print("  ✅ Has allowance check")
    else:
        print("  ✅ May be simple approve+stake")
    if 'approve' in stake and ('stake' in stake or 'Stake' in stake):
        print("  ✅ Has both approve and stake calls")
    # Check for try/catch
    if 'try' in stake and 'catch' in stake:
        print("  ✅ Has error handling")
    
# Analyze vote function
vote = find_func(js, 'vote')
if vote:
    print("\n=== vote ===")
    if 'try' in vote:
        print("  ✅ Has error handling")
    # Check for contract call
    if 'auditDAO' in vote:
        print("  ✅ Calls auditDAO contract")

# Check for window onclick redirects
print("\n=== onclick issues ===")
_, html = extract_js('index02.html')
window_clicks = re.findall(r'onclick=["\']window[^"\']*["\']', html)
for w in window_clicks[:5]:
    print(f"  Found: {w[:80]}")

_, html3 = extract_js('index03.html')
window_clicks3 = re.findall(r'onclick=["\']window[^"\']*["\']', html3)
for w in window_clicks3[:5]:
    print(f"  Found: {w[:80]}")

# Check index02.html goTo navigation
nav_fixes = []
for page, pattern in [('index02.html', 'window.location'), ('index03.html', 'window.location'), ('index04.html', 'window.location')]:
    _, h = extract_js(page)
    matches = re.findall(r'onclick=["\'][^"\']*window\.location[^"\']*["\']', h)
    for m in matches:
        # Check if it's a valid URL
        if 'index' in m or 'http' in m:
            nav_fixes.append(f"  {page}: {m[:80]}")

print("\n=== Navigation links ===")
for n in nav_fixes:
    print(n)
