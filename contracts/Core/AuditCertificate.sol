// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuditCertificate
 * @dev 审计证书NFT - 提案Finalized后铸造，链上可验证的审计成果
 *
 * === 功能 ===
 * - 审计完成后，为审计团队/社区贡献者铸造NFT证书
 * - 证书包含：项目名、审计时间、风险等级、最终报告哈希（metadata URI）
 * - 不可转让（Soulbound），作为链上声誉证明
 *
 * === 黑客松亮点 ===
 * "链上可验证成果" - 每个通过的审计都生成唯一NFT证书
 */
contract AuditCertificate is ERC721URIStorage, Ownable {
    uint256 public nextTokenId;
    address public auditDAO;

    struct CertificateInfo {
        uint256 tokenId;
        uint256 proposalId;
        bytes32 finalHash;
        RiskLevel riskLevel;
        uint256 issuedAt;
    }

    enum RiskLevel { None, Low, Medium, High, Critical }

    mapping(uint256 => CertificateInfo) public certificates; // tokenId => info
    mapping(uint256 => bool) public proposalCertified;       // proposalId => 是否已发证
    mapping(address => uint256[]) public auditorCertificates; // 审计者持有的证书列表

    event CertificateMinted(
        uint256 indexed tokenId,
        uint256 indexed proposalId,
        address indexed recipient,
        bytes32 finalHash,
        RiskLevel riskLevel
    );

    modifier onlyAuditDAO() {
        require(msg.sender == auditDAO, "Only AuditDAO can mint");
        _;
    }

    constructor() ERC721("Audit Certificate", "AUDIT") Ownable(msg.sender) {}

    function setAuditDAO(address _auditDAO) external onlyOwner {
        require(_auditDAO != address(0), "Invalid address");
        auditDAO = _auditDAO;
    }

    /// @dev 铸造审计证书（由AuditDAO在提案Finalized时调用）
    function mintCertificate(
        address recipient,
        uint256 proposalId,
        bytes32 finalHash,
        RiskLevel riskLevel,
        string memory metadataURI
    ) external onlyAuditDAO returns (uint256) {
        require(!proposalCertified[proposalId], "Certificate already issued");
        require(recipient != address(0), "Invalid recipient");

        uint256 tokenId = nextTokenId++;
        _mint(recipient, tokenId);
        _setTokenURI(tokenId, metadataURI);

        certificates[tokenId] = CertificateInfo({
            tokenId: tokenId,
            proposalId: proposalId,
            finalHash: finalHash,
            riskLevel: riskLevel,
            issuedAt: block.timestamp
        });

        proposalCertified[proposalId] = true;
        auditorCertificates[recipient].push(tokenId);

        emit CertificateMinted(tokenId, proposalId, recipient, finalHash, riskLevel);
        return tokenId;
    }

    /// @dev Soulbound: 不可转让
    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: non-transferable");
    }

    /// @dev Soulbound: 不可批准
    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: non-transferable");
    }

    /// @dev Soulbound: 不可设置审批
    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert("Soulbound: non-transferable");
    }

    // ==================== 查询函数 ====================

    function getCertificateInfo(uint256 tokenId) external view returns (
        uint256 id,
        uint256 proposalId,
        bytes32 finalHash,
        RiskLevel riskLevel,
        uint256 issuedAt
    ) {
        CertificateInfo storage cert = certificates[tokenId];
        require(cert.issuedAt > 0, "Certificate does not exist");
        return (cert.tokenId, cert.proposalId, cert.finalHash, cert.riskLevel, cert.issuedAt);
    }

    function getAuditorCertificates(address auditor) external view returns (uint256[] memory) {
        return auditorCertificates[auditor];
    }

    function getAuditorCertificateCount(address auditor) external view returns (uint256) {
        return auditorCertificates[auditor].length;
    }

    function isCertified(uint256 proposalId) external view returns (bool) {
        return proposalCertified[proposalId];
    }

    function totalCertificates() external view returns (uint256) {
        return nextTokenId;
    }
}
