from typing import Dict, List, Optional
from enum import Enum
from dataclasses import dataclass, field


class ServiceTier(str, Enum):
    STANDARD = "standard"
    DEEP = "deep"


class ComplexityLevel(str, Enum):
    SIMPLE = "simple"
    MODERATE = "moderate"
    COMPLEX = "complex"
    HIGHLY_COMPLEX = "highly_complex"


class AssetPoolSize(str, Enum):
    MICRO = "micro"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    EXTRA_LARGE = "extra_large"


@dataclass
class TierConfig:
    tier: ServiceTier
    name_zh: str
    name_en: str
    description: str
    includes: List[str]
    price_range_min: float
    price_range_max: float
    default_price: float
    positioning: str
    icon: str
    color: str
    gradient: str


@dataclass
class ComplexityMultiplier:
    level: ComplexityLevel
    name_zh: str
    multiplier: float
    description: str


@dataclass
class AssetPoolMultiplier:
    size: AssetPoolSize
    name_zh: str
    tvl_range: str
    multiplier: float


@dataclass
class DiscountTier:
    min_stake_amount: int
    name_zh: str
    fee_discount_pct: int
    priority_boost: bool


TIER_CONFIGS: Dict[str, TierConfig] = {
    ServiceTier.STANDARD.value: TierConfig(
        tier=ServiceTier.STANDARD,
        name_zh="标准版",
        name_en="Standard",
        description="AI 筛查 + 社区去中心化审核 + 最终报告",
        includes=[
            "AI 深度筛查 + 社区去中心化审核",
            "多维度安全分析报告",
            "漏洞风险等级评定",
            "修复建议与最佳实践",
            "分歧仲裁机制覆盖",
            "5-10 个工作日内交付",
        ],
        price_range_min=49,
        price_range_max=499,
        default_price=99,
        positioning="主推爆款。对标 Sher10k 等众包审计，价格有竞争力",
        icon="⭐",
        color="#ffd54f",
        gradient="linear-gradient(135deg, #ffd54f, #ffb300)",
    ),
    ServiceTier.DEEP.value: TierConfig(
        tier=ServiceTier.DEEP,
        name_zh="深度版",
        name_en="Deep",
        description="标准版 + 审计团队深度介入 + 高频分歧委员会支持",
        includes=[
            "标准版全部服务",
            "资深审计团队深度介入",
            "人工逐行代码审查",
            "高频分歧委员会专属通道",
            "持续安全监控（可选）",
            "优先响应 + 加急处理",
        ],
        price_range_min=25000,
        price_range_max=80000,
        default_price=499,
        positioning="面向大型 DeFi、RWA、公链基础设施，价格为传统巨头的 1/2 到 1/5",
        icon="🛡️",
        color="#ef5350",
        gradient="linear-gradient(135deg, #ef5350, #c62828)",
    ),
}

COMPLEXITY_MULTIPLIERS: List[ComplexityMultiplier] = [
    ComplexityMultiplier(
        level=ComplexityLevel.SIMPLE,
        name_zh="简单",
        multiplier=0.7,
        description="单一合约，<500 行代码，无复杂交互",
    ),
    ComplexityMultiplier(
        level=ComplexityLevel.MODERATE,
        name_zh="中等",
        multiplier=1.0,
        description="2-5 个合约，500-2000 行代码，有跨合约调用",
    ),
    ComplexityMultiplier(
        level=ComplexityLevel.COMPLEX,
        name_zh="复杂",
        multiplier=1.5,
        description="5-15 个合约，2000-10000 行代码，复杂 DeFi 协议",
    ),
    ComplexityMultiplier(
        level=ComplexityLevel.HIGHLY_COMPLEX,
        name_zh="高度复杂",
        multiplier=2.0,
        description="15+ 个合约，10000+ 行代码，跨链/RWA/公链基础设施",
    ),
]

ASSET_POOL_MULTIPLIERS: List[AssetPoolMultiplier] = [
    AssetPoolMultiplier(size=AssetPoolSize.MICRO, name_zh="微型", tvl_range="<$10万", multiplier=0.8),
    AssetPoolMultiplier(size=AssetPoolSize.SMALL, name_zh="小型", tvl_range="$10万-$100万", multiplier=1.0),
    AssetPoolMultiplier(size=AssetPoolSize.MEDIUM, name_zh="中型", tvl_range="$100万-$1000万", multiplier=1.3),
    AssetPoolMultiplier(size=AssetPoolSize.LARGE, name_zh="大型", tvl_range="$1000万-$1亿", multiplier=1.6),
    AssetPoolMultiplier(size=AssetPoolSize.EXTRA_LARGE, name_zh="超大型", tvl_range=">$1亿", multiplier=2.0),
]

DISCOUNT_TIERS: List[DiscountTier] = [
    DiscountTier(min_stake_amount=0, name_zh="基础", fee_discount_pct=0, priority_boost=False),
    DiscountTier(min_stake_amount=1000, name_zh="白银", fee_discount_pct=5, priority_boost=False),
    DiscountTier(min_stake_amount=5000, name_zh="黄金", fee_discount_pct=10, priority_boost=True),
    DiscountTier(min_stake_amount=25000, name_zh="铂金", fee_discount_pct=15, priority_boost=True),
    DiscountTier(min_stake_amount=100000, name_zh="钻石", fee_discount_pct=20, priority_boost=True),
]

TOKEN_PAYMENT_DISCOUNT_PCT = 15
BOUNTY_COMMISSION_PCT_MIN = 10
BOUNTY_COMMISSION_PCT_MAX = 20
BOUNTY_COMMISSION_PCT_DEFAULT = 15
ARBITRATION_DEPOSIT_MIN = 2000
ARBITRATION_DEPOSIT_MAX = 5000
ARBITRATION_DEPOSIT_DEFAULT = 3000
COMMITTEE_STARTUP_FEE_MIN = 500
COMMITTEE_STARTUP_FEE_MAX = 1500
COMMITTEE_STARTUP_FEE_DEFAULT = 1000
AUDIT_EARN_RETURN_PCT = 5


@dataclass
class PricingInput:
    tier: ServiceTier
    complexity: ComplexityLevel = ComplexityLevel.MODERATE
    asset_pool_size: AssetPoolSize = AssetPoolSize.SMALL
    code_lines: int = 1000
    contract_count: int = 1
    need_bounty: bool = False
    bounty_amount: float = 0.0
    has_dispute: bool = False
    pay_with_token: bool = False
    stake_amount: int = 0


@dataclass
class PricingBreakdown:
    tier: str
    tier_name: str
    base_price: float
    complexity_multiplier: float
    complexity_name: str
    asset_pool_multiplier: float
    asset_pool_name: str
    adjusted_base_fee: float
    bounty_fee: float
    bounty_commission_pct: int
    bounty_commission_amount: float
    arbitration_deposit: float
    committee_fee: float
    token_discount_pct: int
    token_discount_amount: float
    staking_discount_pct: int
    staking_discount_amount: float
    total_before_discount: float
    total_after_discount: float
    audit_earn_return: float
    final_payable: float
    breakdown_text: dict


def get_tier_config(tier: ServiceTier) -> TierConfig:
    return TIER_CONFIGS[tier.value]


def get_complexity_multiplier(level: ComplexityLevel) -> ComplexityMultiplier:
    for cm in COMPLEXITY_MULTIPLIERS:
        if cm.level == level:
            return cm
    return COMPLEXITY_MULTIPLIERS[1]


def get_asset_pool_multiplier(size: AssetPoolSize) -> AssetPoolMultiplier:
    for ap in ASSET_POOL_MULTIPLIERS:
        if ap.size == size:
            return ap
    return ASSET_POOL_MULTIPLIERS[1]


def get_staking_discount(stake_amount: int) -> tuple:
    discount_pct = 0
    tier_name = "基础"
    priority = False
    for dt in sorted(DISCOUNT_TIERS, key=lambda x: x.min_stake_amount, reverse=True):
        if stake_amount >= dt.min_stake_amount:
            discount_pct = dt.fee_discount_pct
            tier_name = dt.name_zh
            priority = dt.priority_boost
            break
    return discount_pct, tier_name, priority


def calculate_base_price(tier: ServiceTier, complexity: ComplexityLevel, asset_pool_size: AssetPoolSize) -> float:
    tier_config = get_tier_config(tier)
    complexity_mult = get_complexity_multiplier(complexity)
    asset_mult = get_asset_pool_multiplier(asset_pool_size)

    adjusted = tier_config.default_price * complexity_mult.multiplier * asset_mult.multiplier
    adjusted = max(adjusted, tier_config.price_range_min)
    adjusted = min(adjusted, tier_config.price_range_max)

    return round(adjusted, 2)


def calculate_pricing(input_data: PricingInput) -> PricingBreakdown:
    tier_config = get_tier_config(input_data.tier)
    complexity_cfg = get_complexity_multiplier(input_data.complexity)
    asset_pool_cfg = get_asset_pool_multiplier(input_data.asset_pool_size)

    base_price = tier_config.default_price
    adjusted_base_fee = calculate_base_price(input_data.tier, input_data.complexity, input_data.asset_pool_size)

    bounty_commission_pct = BOUNTY_COMMISSION_PCT_DEFAULT
    bounty_commission_amount = 0.0
    bounty_fee = 0.0
    if input_data.need_bounty and input_data.bounty_amount > 0:
        bounty_commission_amount = round(input_data.bounty_amount * bounty_commission_pct / 100, 2)
        bounty_fee = input_data.bounty_amount

    arbitration_deposit = ARBITRATION_DEPOSIT_DEFAULT if input_data.has_dispute else 0.0
    committee_fee = COMMITTEE_STARTUP_FEE_DEFAULT if input_data.has_dispute else 0.0

    total_before_discount = adjusted_base_fee + bounty_commission_amount + arbitration_deposit + committee_fee

    token_discount_pct = TOKEN_PAYMENT_DISCOUNT_PCT if input_data.pay_with_token else 0
    token_discount_amount = round(total_before_discount * token_discount_pct / 100, 2)

    staking_discount_pct, staking_tier_name, _ = get_staking_discount(input_data.stake_amount)
    staking_discount_amount = round(total_before_discount * staking_discount_pct / 100, 2)

    total_discount = token_discount_amount + staking_discount_amount
    total_after_discount = round(total_before_discount - total_discount, 2)

    audit_earn_return = round(adjusted_base_fee * AUDIT_EARN_RETURN_PCT / 100, 2)

    final_payable = max(total_after_discount, 0)

    breakdown_text = {
        "summary": (
            f"【{tier_config.name_zh}】审计服务，"
            f"复杂度：{complexity_cfg.name_zh}（×{complexity_cfg.multiplier}），"
            f"资产池：{asset_pool_cfg.name_zh}（×{asset_pool_cfg.multiplier}）"
        ),
        "formula": (
            f"${tier_config.default_price:,.2f}（基础价）× "
            f"{complexity_cfg.multiplier}（{complexity_cfg.name_zh}复杂度）× "
            f"{asset_pool_cfg.multiplier}（{asset_pool_cfg.name_zh}资产池）= "
            f"${adjusted_base_fee:,.2f}"
        ),
        "token_discount_desc": (
            f"使用 CEAT 代币支付享 {TOKEN_PAYMENT_DISCOUNT_PCT}% 折扣" if input_data.pay_with_token else ""
        ),
        "staking_discount_desc": (
            f"质押等级「{staking_tier_name}」享 {staking_discount_pct}% 费用减免" if staking_discount_pct > 0 else ""
        ),
    }

    return PricingBreakdown(
        tier=input_data.tier.value,
        tier_name=tier_config.name_zh,
        base_price=base_price,
        complexity_multiplier=complexity_cfg.multiplier,
        complexity_name=complexity_cfg.name_zh,
        asset_pool_multiplier=asset_pool_cfg.multiplier,
        asset_pool_name=asset_pool_cfg.name_zh,
        adjusted_base_fee=adjusted_base_fee,
        bounty_fee=bounty_fee,
        bounty_commission_pct=bounty_commission_pct,
        bounty_commission_amount=bounty_commission_amount,
        arbitration_deposit=arbitration_deposit,
        committee_fee=committee_fee,
        token_discount_pct=token_discount_pct,
        token_discount_amount=token_discount_amount,
        staking_discount_pct=staking_discount_pct,
        staking_discount_amount=staking_discount_amount,
        total_before_discount=total_before_discount,
        total_after_discount=total_after_discount,
        audit_earn_return=audit_earn_return,
        final_payable=final_payable,
        breakdown_text=breakdown_text,
    )


def get_all_tiers_summary() -> list:
    return [
        {
            "tier": tc.tier.value,
            "name": tc.name_zh,
            "description": tc.description,
            "price_range": f"${tc.price_range_min:,.0f} - ${tc.price_range_max:,.0f}",
            "default_price": tc.default_price,
            "includes": tc.includes,
            "positioning": tc.positioning,
            "icon": tc.icon,
            "color": tc.color,
            "gradient": tc.gradient,
        }
        for tc in TIER_CONFIGS.values()
    ]


def get_all_multipliers() -> dict:
    return {
        "complexity": [
            {"level": cm.level.value, "name": cm.name_zh, "multiplier": cm.multiplier, "description": cm.description}
            for cm in COMPLEXITY_MULTIPLIERS
        ],
        "asset_pool": [
            {"size": ap.size.value, "name": ap.name_zh, "tvl_range": ap.tvl_range, "multiplier": ap.multiplier}
            for ap in ASSET_POOL_MULTIPLIERS
        ],
    }


def get_discount_info() -> dict:
    return {
        "token_payment_discount_pct": TOKEN_PAYMENT_DISCOUNT_PCT,
        "staking_tiers": [
            {"min_stake": dt.min_stake_amount, "name": dt.name_zh, "discount_pct": dt.fee_discount_pct, "priority": dt.priority_boost}
            for dt in DISCOUNT_TIERS
        ],
        "bounty_commission": {
            "min_pct": BOUNTY_COMMISSION_PCT_MIN,
            "max_pct": BOUNTY_COMMISSION_PCT_MAX,
            "default_pct": BOUNTY_COMMISSION_PCT_DEFAULT,
        },
        "dispute_fees": {
            "deposit_min": ARBITRATION_DEPOSIT_MIN,
            "deposit_max": ARBITRATION_DEPOSIT_MAX,
            "deposit_default": ARBITRATION_DEPOSIT_DEFAULT,
            "committee_min": COMMITTEE_STARTUP_FEE_MIN,
            "committee_max": COMMITTEE_STARTUP_FEE_MAX,
            "committee_default": COMMITTEE_STARTUP_FEE_DEFAULT,
        },
        "audit_earn_return_pct": AUDIT_EARN_RETURN_PCT,
    }
