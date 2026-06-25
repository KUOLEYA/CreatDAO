#!/usr/bin/env python3
"""Shorten require strings in AuditDAO.sol to reduce bytecode size."""
import re

with open('contracts/Governance/AuditDAO.sol', 'r') as f:
    content = f.read()

replacements = {
    '"Amount must be positive"': '"!pos"',
    '"Insufficient balance"': '"!bal"',
    '"No rewards to claim"': '"!rwd"',
    '"Insufficient contract balance"': '"!cbl"',
    '"Insufficient stake"': '"!stk"',
    '"Not a staker"': '"!stkr"',
    '"Audit team address cannot be zero"': '"!azero"',
    '"Must have exactly 5 committee members"': '"!c5"',
    '"Reward rate too high"': '"!rhigh"',
    '"Penalty rate too high"': '"!phigh"',
    '"At least 2 members required"': '"!m2"',
    '"Name required"': '"!name"',
    '"Invalid contract address"': '"!addr"',
    '"Team already registered"': '"!regd"',
    '"Team already inactive"': '"!inact"',
    '"Team not active"': '"!tact"',
    '"Insufficient stake to submit proposal"': '"!stk2"',
    '"Hash already submitted"': '"!hash"',
    '"Already voted"': '"!voted"',
    '"Invalid proposal hash"': '"!phash"',
    '"Already voted on acceptance"': '"!vacpt"',
    '"Already voted on second review"': '"!v2nd"',
    '"Transfer failed"': '"!txf"',
    '"Invalid status to start community review"': '"!s-cr"',
    '"Team report required first"': '"!treq"',
    '"Invalid status for community proposal"': '"!s-cp"',
    '"Invalid status to start voting"': '"!s-sv"',
    '"No community proposals submitted"': '"!ncps"',
    '"Not in community review phase"': '"!cr!"',
    '"Voting has ended"': '"!vend"',
    '"Vote amount must be at least min stake"': '"!vmin"',
    '"Not in discussion phase"': '"!disc"',
    '"Discussion not ended"': '"!dend"',
    '"Only audit team can submit revised report"': '"!team"',
    '"Not in second review phase"': '"!sr!"',
    '"Revised hash cannot be zero"': '"!rhash"',
    '"No revised report submitted"': '"!nrev"',
    '"Only committee members can vote"': '"!cmem"',
    '"Not in committee ruling phase"': '"!cr!"',
    '"Only owner or audit team can set risk level"': '"!auth"',
    '"Not in arbitrable state"': '"!arb!"',
    '"Risk level too low for arbitration"': '"!rlow"',
    '"Insufficient arbitration deposit"': '"!adep"',
    '"Dispute retention period not met"': '"!drpm"',
    '"Not authorized"': '"!auth"',
    '"Invalid hash"': '"!hash2"',
    '"Report already deposited"': '"!dep"',
    '"Only audit team can initiate veto"': '"!team2"',
    '"Only arbitrated or committee-ruled proposals can be vetoed"': '"!veto_state"',
    '"Veto already initiated"': '"!veto_done"',
    '"Evidence required"': '"!evid"',
    '"Not in veto review phase"': '"!vr!"',
    '"Veto not initiated"': '"!vnot"',
    '"Already reviewed veto"': '"!rvoted"',
    '"Final hash cannot be zero"': '"!fhash"',
    '"Already voted on second review"': '"!v2nd"',
    '"Already voted on acceptance"': '"!vacpt"',
}

count = 0
for old, new in replacements.items():
    c = content.count(old)
    if c > 0:
        content = content.replace(old, new)
        count += c
        print(f"  ✓ {old[:45]:46s} → {new}  ({c}x)")
    else:
        print(f"  · Not found: {old}")

# Verify no readable error strings remain (except very short ones)
remaining = re.findall(r'require\([^,]+,\s*"([^"]{6,})"\)', content)
if remaining:
    print(f"\n⚠ Remaining long strings ({len(remaining)}):")
    for s in remaining:
        print(f"  [{len(s):2d}] {s}")

with open('contracts/Governance/AuditDAO.sol', 'w') as f:
    f.write(content)

print(f"\n✅ Done! {count} replacements made.")
