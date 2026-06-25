// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/Ownable.sol";

// ERC-792 IArbitrator 接口定义
interface IArbitrator {
    function createDispute(uint256 _choices, bytes calldata _extraData) external payable returns (uint256 disputeID);
    function arbitrationCost(bytes calldata _extraData) external view returns (uint256 cost);
    function disputeStatus(uint256 _disputeID) external view returns (uint8 status);
}

// ERC-792 IArbitrable 接口定义（用于接收裁决回调）
interface IArbitrable {
    function rule(uint256 _disputeID, uint256 _ruling) external;
}

// AuditDAO 接口 - 更新以匹配新的仲裁流程
interface IAuditDAOArb {
    function finalizeWithArbitration(uint256 proposalId, bytes32 finalHash) external;
}

/**
 * @title KlerosArbitrationProxy
 * @dev Kleros仲裁适配器 - 集成Kleros API + 链上仲裁合约（符合ERC-792）
 *
 * === 第三阶段第4步：第三方独立仲裁 ===
 * 前置条件（已在 AuditDAO.requestArbitration() 中校验）：
 * 1. 争议涉及高危分歧（riskLevel >= High）
 * 2. 申请方缴纳足额仲裁押金
 * 3. 争议已连续留存超过规定周期
 *
 * 流程：
 * 1. AuditDAO.requestArbitration() 通过条件检查并设置状态为 Arbitration
 * 2. 用户调用本合约 submitToArbitration() 提交到 Kleros 法庭
 * 3. Kleros 裁决后回调 rule()
 * 4. 任何人调用 resolveDispute() 将裁决结果上链
 */
contract KlerosArbitrationProxy is IArbitrable, Ownable {
    address public auditDAO;
    IArbitrator public klerosCourt;
    uint256 public arbitrationFee;

    struct Dispute {
        uint256 id;
        uint256 auditProposalId;
        bytes32 hashOption1;          // 第一个哈希选项（通常是审计报告哈希）
        bytes32 hashOption2;          // 第二个哈希选项（通常是社区获胜哈希）
        address applicant;            // 申请人
        uint256 klerosDisputeId;      // Kleros返回的争议ID
        bool ruled;                   // 是否已裁决
        uint256 ruling;               // Kleros裁决值（1=选项1, 2=选项2）
        bool resolved;                // 是否已解决上链
        uint256 feePaid;              // 实际支付的仲裁费用
    }

    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => uint256) private klerosToLocalDispute;
    uint256 public nextDisputeId;

    event ArbitrationRequested(
        uint256 indexed disputeId,
        uint256 auditProposalId,
        address applicant,
        uint256 klerosDisputeId,
        bytes32 hashOption1,
        bytes32 hashOption2,
        uint256 feePaid
    );
    event ArbitrationRuled(uint256 indexed disputeId, uint256 ruling);
    event DisputeResolved(uint256 indexed disputeId, uint256 auditProposalId, bytes32 finalHash);
    event ArbitrationFeeUpdated(uint256 oldFee, uint256 newFee);
    event EtherWithdrawn(address indexed recipient, uint256 amount);

    constructor(address _auditDAO, address _klerosCourt, uint256 _fee) Ownable(msg.sender) {
        require(_auditDAO != address(0), "Invalid AuditDAO address");
        require(_klerosCourt != address(0), "Invalid Kleros court address");
        require(_fee > 0, "Fee must be positive");

        auditDAO = _auditDAO;
        klerosCourt = IArbitrator(_klerosCourt);
        arbitrationFee = _fee;
    }

    /**
     * @dev 第三阶段第4步：提交到Kleros仲裁
     * 前置条件：AuditDAO.requestArbitration() 已通过条件检查
     *
     * @param auditProposalId AuditDAO中的提案ID
     * @param hashOption1 选项1哈希（审计团队报告哈希）
     * @param hashOption2 选项2哈希（社区获胜哈希）
     */
    function submitToArbitration(
        uint256 auditProposalId,
        bytes32 hashOption1,
        bytes32 hashOption2
    ) external payable returns (uint256) {
        require(msg.value >= arbitrationFee, "Insufficient arbitration fee");
        require(hashOption1 != bytes32(0), "Hash option 1 cannot be zero");
        require(hashOption2 != bytes32(0), "Hash option 2 cannot be zero");

        // 编码extraData：包含提案ID和两个哈希选项
        bytes memory extraData = abi.encode(auditProposalId, hashOption1, hashOption2);

        // 查询Kleros实际仲裁费用
        uint256 actualCost = klerosCourt.arbitrationCost(extraData);
        require(actualCost > 0, "Invalid arbitration cost");
        require(msg.value >= actualCost, "Insufficient payment for Kleros");

        // 创建本地争议记录
        uint256 disputeId = nextDisputeId++;
        Dispute storage dispute = disputes[disputeId];
        dispute.id = disputeId;
        dispute.auditProposalId = auditProposalId;
        dispute.hashOption1 = hashOption1;
        dispute.hashOption2 = hashOption2;
        dispute.applicant = msg.sender;
        dispute.ruled = false;
        dispute.ruling = 0;
        dispute.resolved = false;
        dispute.feePaid = actualCost;

        // 调用Kleros创建争议（2个选项：支持选项1或选项2）
        uint256 klerosDisputeId = klerosCourt.createDispute{value: actualCost}(2, extraData);
        dispute.klerosDisputeId = klerosDisputeId;

        // 建立映射关系（存储时+1，避免0值歧义）
        klerosToLocalDispute[klerosDisputeId] = disputeId + 1;

        // 退回多余支付的ETH
        if (msg.value > actualCost) {
            uint256 refund = msg.value - actualCost;
            (bool success, ) = payable(msg.sender).call{value: refund}("");
            require(success, "Refund failed");
        }

        emit ArbitrationRequested(disputeId, auditProposalId, msg.sender, klerosDisputeId, hashOption1, hashOption2, actualCost);
        return disputeId;
    }

    /**
     * @dev 裁决回调函数 - 由Kleros调用（符合ERC-792 IArbitrable接口）
     */
    function rule(uint256 disputeID, uint256 ruling) external override {
        require(msg.sender == address(klerosCourt), "Only Kleros can rule");
        require(ruling == 1 || ruling == 2, "Invalid ruling value");

        uint256 storedId = klerosToLocalDispute[disputeID];
        require(storedId != 0, "Dispute not found");

        uint256 localDisputeId = storedId - 1;
        Dispute storage dispute = disputes[localDisputeId];
        require(!dispute.ruled, "Already ruled");
        require(dispute.klerosDisputeId == disputeID, "Dispute ID mismatch");

        dispute.ruled = true;
        dispute.ruling = ruling;

        emit ArbitrationRuled(localDisputeId, ruling);
    }

    /**
     * @dev 第三阶段第4步：解决争议 - 将Kleros仲裁结果上链到AuditDAO
     * 调用 AuditDAO.finalizeWithArbitration() 存入最终报告哈希
     * AuditDAO.finalizeWithArbitration() 要求提案状态为 Arbitration
     */
    function resolveDispute(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];

        require(dispute.applicant != address(0), "Dispute does not exist");
        require(dispute.ruled, "Dispute not yet ruled");
        require(!dispute.resolved, "Already resolved");
        require(dispute.ruling == 1 || dispute.ruling == 2, "Invalid ruling value");

        // 根据裁决确定最终哈希
        bytes32 finalHash = dispute.ruling == 1 ? dispute.hashOption1 : dispute.hashOption2;
        require(finalHash != bytes32(0), "Final hash cannot be zero");

        // 调用 AuditDAO.finalizeWithArbitration(proposalId, finalHash)
        // 该函数要求提案状态为 Arbitration（由 AuditDAO.requestArbitration() 设置）
        (bool success, ) = auditDAO.call(
            abi.encodeWithSignature(
                "finalizeWithArbitration(uint256,bytes32)",
                dispute.auditProposalId,
                finalHash
            )
        );
        require(success, "Finalization failed");

        dispute.resolved = true;

        emit DisputeResolved(disputeId, dispute.auditProposalId, finalHash);
    }

    // ==================== 查询函数 ====================

    function getDispute(uint256 disputeId) external view returns (
        uint256 id,
        uint256 auditProposalId,
        bytes32 hashOption1,
        bytes32 hashOption2,
        address applicant,
        uint256 klerosDisputeId,
        bool ruled,
        uint256 ruling,
        bool resolved,
        uint256 feePaid
    ) {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.applicant != address(0), "Dispute does not exist");

        return (
            dispute.id,
            dispute.auditProposalId,
            dispute.hashOption1,
            dispute.hashOption2,
            dispute.applicant,
            dispute.klerosDisputeId,
            dispute.ruled,
            dispute.ruling,
            dispute.resolved,
            dispute.feePaid
        );
    }

    function getArbitrationCost(
        uint256 auditProposalId,
        bytes32 hashOption1,
        bytes32 hashOption2
    ) external view returns (uint256) {
        bytes memory extraData = abi.encode(auditProposalId, hashOption1, hashOption2);
        return klerosCourt.arbitrationCost(extraData);
    }

    function getMinArbitrationFee() external view returns (uint256) {
        return arbitrationFee;
    }

    // ==================== 管理函数 ====================

    function updateArbitrationFee(uint256 newFee) external onlyOwner {
        require(newFee > 0, "Fee must be positive");

        uint256 oldFee = arbitrationFee;
        arbitrationFee = newFee;

        emit ArbitrationFeeUpdated(oldFee, newFee);
    }

    function withdrawEther(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit EtherWithdrawn(recipient, amount);
    }

    function setAuditDAO(address _auditDAO) external onlyOwner {
        require(_auditDAO != address(0), "Invalid AuditDAO address");
        auditDAO = _auditDAO;
    }

    function setKlerosCourt(address _klerosCourt) external onlyOwner {
        require(_klerosCourt != address(0), "Invalid Kleros court address");
        klerosCourt = IArbitrator(_klerosCourt);
    }
}
