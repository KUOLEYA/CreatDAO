# CeatDAO — 去中心化智能合约审计 DAO 平台

> AI × Web3 驱动的智能合约安全审计与治理平台：AI 审计 → 链上提案 → 社区投票 → 四段式争议解决 → 链上报告存证。

## 项目简介

CeatDAO 是一个将 **AI 智能审计** 与 **Web3 DAO 治理** 深度融合的去中心化审计平台。项目方上传合约代码后，由 DeepSeek AI 完成首轮流漏洞分析，审计结果以 hash 形式上链生成提案；随后审计团队与社区共同审核、投票；当双方意见不一致时，启动「社区投票 → 审计团队二次复核 → 5 人委员会裁决 → Kleros 仲裁」四段式争议解决流程，最终报告链上存证。整个过程由 CEAT 代币经济驱动，质押即获投票权，参与即奖励，正确额外奖励，恶意投票惩罚。

## 核心特性

- **AI × Web3 真融合**：AI 审计报告生成 hash → 链上提案存证 → 社区对 AI 结果投票，AI 输出直接成为链上治理输入
- **四段式争议解决**：社区投票认可 → 审计团队二次复核 → 委员会 3/5 裁决 → Kleros 仲裁终局
- **三参数投票奖惩**：参与奖励 1% + 投对奖励 7% + 恶意惩罚 4%，优于传统二分奖惩
- **拆分投票机制**：用户可对多个方案分配权重，非单一投票
- **治理 Timelock**：关键参数变更需链上授权，防止 owner 滥权
- **CEAT 代币闭环**：质押获投票权 → 提案费消耗 → 奖励回流 → 惩罚销毁
- **分层定价系统**：按代码行数 × 复杂度 × 资产池规模计费
- **双网络支持**：Hardhat 本地测试网 + Sepolia 测试网自动切换

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 智能合约 | Solidity 0.8.24 / Hardhat / OpenZeppelin | 5 个合约共 1441 行 |
| 后端 | Python / FastAPI / SQLAlchemy / web3.py | 2294 行，含事件监听器 |
| AI 引擎 | DeepSeek API | 结构化漏洞分析 |
| 前端 | HTML / 原生 JS / ethers.js | 12 个页面，MetaMask 集成 |
| 数据库 | SQLite（默认）/ PostgreSQL（可选） | 链下索引 |

## 项目结构

```
.
├── contracts/                  # 智能合约
│   ├── Governance/
│   │   └── AuditDAOv2.sol      # 核心治理合约 (929 行)
│   ├── Core/
│   │   ├── AuditTeamManager.sol
│   │   ├── DepositProof.sol
│   │   └── AuditCertificate.sol
│   └── Token/
│       └── CeatToken.sol       # ERC20 治理代币
├── backend/                    # FastAPI 后端
│   ├── main.py                 # 入口 + 事件监听器
│   ├── audit_api.py            # AI 审计接口
│   ├── pricing_api.py          # 分层定价
│   ├── pricing_config.py       # 定价配置
│   ├── contract_utils.py       # 链上交互封装
│   ├── models.py / schemas.py  # 数据模型
│   └── abi/                    # 合约 ABI
├── frontend/                   # 前端页面
│   ├── home.html               # 平台入口
│   ├── ai-review.html          # AI 审计 + 支付 + 创建提案
│   ├── dashboard.html          # 用户端（质押/投票/争议）
│   ├── admin.html              # 管理员端
│   ├── audit-team.html         # 审计团队工作台
│   ├── report-writing.html     # 审计报告编写
│   ├── community-report-writing.html
│   ├── dispute-committee.html  # 争议委员会
│   ├── pricing.html            # 定价
│   └── *.js / *.css            # 公共脚本与样式
├── scripts/                    # 部署与测试脚本
│   ├── local_deploy.js         # 本地部署
│   ├── local_full_test.js      # 本地全流程测试
│   ├── deploy_sepolia.js       # Sepolia 部署
│   └── advance_time.js         # 快进时间
├── test/
│   └── AuditDAOv2.test.js      # 合约测试 (483 行)
├── hardhat.config.js
├── .env.example                # 环境变量模板
└── 测试操作流程文档.md          # 详细操作文档
```

## 业务流程

```
用户上传代码
    ↓
DeepSeek AI 审计 → 生成报告 hash
    ↓
支付 CEAT 代币 → 创建链上提案 (Submitted)
    ↓
审计团队提交正式报告 (TeamReview)
    ↓
社区质押 CEAT + 领取提案 + 提交社区方案 (CommunityReview)
    ↓
开启投票 → 社区投票 → 结束投票 (Discussion)
    ↓
结束讨论 → 比对社区胜出方案与审计团队报告
    ├── 一致 → Finalized (奖励自动结算)
    └── 不一致 → 进入争议解决
                ↓
            ① 社区投票认可审计团队？(FirstDispute)
                ├── 认可 → Finalized
                └── 拒绝 → ② 审计团队二次复核 (SecondReview)
                            ├── 通过 → Finalized
                            └── 未通过 → ③ 委员会 5 人投票 3/5 通过 (CommitteeRuling)
                                        └── (可选) Kleros 仲裁终局 (Arbitration)
    ↓
领取奖励
```

## 快速开始

### 环境要求

- Node.js ≥ 18
- Python ≥ 3.10
- MetaMask 浏览器插件

### 1. 安装依赖

```bash
# 前端 + 合约依赖
npm install

# 后端依赖
cd backend
pip install -r requirements.txt
cd ..
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
```

### 3. 启动本地服务（4 个终端）

```bash
# 终端 A — Hardhat 节点
npx hardhat node --hostname 127.0.0.1 --port 8545

# 终端 B — 部署合约（节点启动后执行一次）
npx hardhat run scripts/local_deploy.js --network localhost

# 终端 C — 后端（部署后需重启以读取新 .env）
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 终端 D — 前端
cd frontend
python -m http.server 5500 --bind 127.0.0.1
```

### 4. 访问

- 前端：http://127.0.0.1:5500/home.html
- 后端 API 文档：http://localhost:8000/docs

### 5. MetaMask 配置

添加自定义网络：chainId `31337`，RPC `http://127.0.0.1:8545`，然后导入测试账户私钥（详见 [测试操作流程文档.md](测试操作流程文档.md)）。

## 一键脚本

```bash
# 本地自动化全流程（AI 审计 → DAO 提案 → 投票 → 结束）
npx hardhat run scripts/local_full_test.js --network localhost

# 本地重新部署
npx hardhat run scripts/local_deploy.js --network localhost

# 部署至 Sepolia
npx hardhat run scripts/deploy_sepolia.js --network sepolia

# 运行合约测试
npx hardhat test
```

## 合约说明

| 合约 | 文件 | 行数 | 说明 |
|------|------|------|------|
| AuditDAOv2 | [contracts/Governance/AuditDAOv2.sol](contracts/Governance/AuditDAOv2.sol) | 929 | 核心 DAO 治理：提案、质押、投票、争议、奖励 |
| AuditTeamManager | [contracts/Core/AuditTeamManager.sol](contracts/Core/AuditTeamManager.sol) | 229 | 审计团队注册、停用、分配 |
| AuditCertificate | [contracts/Core/AuditCertificate.sol](contracts/Core/AuditCertificate.sol) | 132 | 审计证书签发 |
| CeatToken | [contracts/Token/CeatToken.sol](contracts/Token/CeatToken.sol) | 87 | ERC20 治理代币 |
| DepositProof | [contracts/Core/DepositProof.sol](contracts/Core/DepositProof.sol) | 46 | 报告 hash 存证 |

### 提案状态机

```
Submitted(0) → TeamReview(1) → CommunityReview(2) → Discussion(3)
                                                        ↓
                                              Finalized(8) ← 共识
                                                        ↓
                                        FirstDispute(4) → SecondReview(5)
                                                                ↓
                                            CommitteeRuling(6) → Arbitration(7) → Finalized(8)
```

## 角色与权限

| 角色 | 地址 | 权限 |
|------|------|------|
| Owner | 账户 1 | 管理员，开启/结束投票，裁决争议 |
| 审计团队 | 账户 2 | 提交正式报告、二次复核 |
| 社区用户 | 账户 3/4/10 | 质押、领取提案、提交方案、投票 |
| 争议委员会 | 账户 5-9 | 5 人委员会，3/5 通过裁决 |

## 文档

- [测试操作流程文档.md](测试操作流程文档.md) — 580+ 行详细操作指南，含 21 步测试清单
- [Q&A.md](Q&A.md) — 黑客松评委 Q&A 预案，20 个常见问题及回答策略
- [后端 API 文档](http://localhost:8000/docs) — FastAPI 自动生成的 Swagger 文档

## 许可证

MIT
