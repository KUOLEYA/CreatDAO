#!/usr/bin/env python3
"""Fix AuditDAO.sol contract size by replacing require strings with custom errors."""
import re

with open('contracts/Governance/AuditDAO.sol', 'r') as f:
    content = f.read()

# Define custom errors and their string mappings
error_map = [
    ("AmountMustBePositive", '"Amount must be positive"'),
    ("InsufficientBalance", '"Insufficient balance"'),
    ("NoRewardsToClaim", '"No rewards to claim"'),
    ("InsufficientContractBalance", '"Insufficient contract balance"'),
    ("InsufficientStake2", '"Insufficient stake"'),
    ("NotStaker", '"Not a staker"'),
    ("ZeroAddress", '"Audit team address cannot be zero"'),
    ("NeedFiveCommittee", '"Must have exactly 5 committee members"'),
    ("RewardRateTooHigh", '"Reward rate too high"'),
    ("PenaltyRateTooHigh", '"Penalty rate too high"'),
    ("MinTwoMembers", '"At least 2 members required"'),
    ("NameRequired", '"Name required"'),
    ("InvalidContractAddr", '"Invalid contract address"'),
    ("TeamAlreadyRegd", '"Team already registered"'),
    ("TeamAlreadyInactive", '"Team already inactive"'),
    ("TeamNotActive", '"Team not active"'),
    ("InsufficientStake", '"Insufficient stake to submit proposal"'),
    ("HashAlreadySub", '"Hash already submitted"'),
    ("AlreadyVoted2", '"Already voted"'),
    ("InvalidProposalHash", '"Invalid proposal hash"'),
    ("AlreadyVotedAccept", '"Already voted on acceptance"'),
    ("AlreadyVotedSecond", '"Already voted on second review"'),
]

# Build custom error definitions
error_defs = "// ==================== Custom Errors ====================\n"
for name, _ in error_map:
    error_defs += f"error {name}();\n"

# Insert before contract declaration
insert_before = "contract AuditDAO is Ownable {"
if insert_before in content:
    idx = content.index(insert_before)
    content = content[:idx] + error_defs + "\n" + content[idx:]

# Replace require(X, "string") with if(!X) revert ErrorName()
for name, old_str in error_map:
    escaped = re.escape(old_str)
    pattern = re.compile(r'require\s*\(\s*([^,]+?)\s*,\s*' + escaped + r'\s*\)')
    
    new_content = []
    count = 0
    for line in content.split('\n'):
        new_line = pattern.sub(
            lambda m, n=name: f'if(!{m.group(1).strip()}) revert {n}()',
            line
        )
        if new_line != line:
            count += 1
        new_content.append(new_line)
    
    content = '\n'.join(new_content)
    if count > 0:
        print(f"  ✓ {name}: replaced {count} occurrence(s)")

with open('contracts/Governance/AuditDAO.sol', 'w') as f:
    f.write(content)

print(f"\n✅ Done! Added {len(error_map)} custom errors and replaced strings.")
