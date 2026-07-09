const CONFIG = {
  API_BASE: (function() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8000/api';
    }
    return '/api';
  })(),

  // 默认合约地址（会被 loadContractAddresses() 覆盖）
  AUDIT_DAO_ADDRESS: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',
  CEAT_TOKEN_ADDRESS: '0xc6e7DF5E7b4f2A278906862b61205850344D4e7d',
  MULTISIG_ADDRESS: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',
  TEAM_MANAGER_ADDRESS: '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1',
  AUDIT_CERTIFICATE_ADDRESS: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',

  // 当前活跃网络（动态检测）
  CHAIN_ID: '0x7a69',
  CHAIN_ID_DEC: 31337,
  RPC_URL: 'http://127.0.0.1:8545',
  NETWORK_NAME: 'Hardhat Local',

  // 网络定义
  NETWORKS: {
    31337: {
      name: 'Hardhat Local',
      hexId: '0x7a69',
      rpcUrl: 'http://127.0.0.1:8545',
      explorerUrl: 'https://etherscan.io',
    },
    11155111: {
      name: 'Sepolia Testnet',
      hexId: '0xaa36a7',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      explorerUrl: 'https://sepolia.etherscan.io',
    },
  },

  SEPOLIA_CHAIN_ID_DEC: 11155111,
  SEPOLIA_CHAIN_ID: '0xaa36a7',
  SEPOLIA_RPC: 'https://ethereum-sepolia-rpc.publicnode.com',
  SEPOLIA_RPC_BACKUPS: [
    'https://sepolia.gateway.tenderly.co',
    'https://rpc.sepolia.org',
    'https://1rpc.io/sepolia',
    'https://rpc2.sepolia.org'
  ],
  SEPOLIA_EXPLORER: 'https://sepolia.etherscan.io',

  CEAT_PRICE_USD: 0.05,
  TEST_REPORT_FEE_USD: 10,

  PROPOSAL_STATUS: [
    'Submitted', 'TeamReview', 'CommunityReview', 'Discussion',
    'FirstDispute', 'SecondReview', 'CommitteeRuling', 'Arbitration',
    'Finalized'
  ],

  PROPOSAL_STATUS_CN: [
    '已录入', '团队审核中', '社区审核中', '公开讨论',
    '分歧判断', '二次复核', '委员会裁决', '独立仲裁',
    '已终结'
  ],

  RISK_LEVELS: ['None', 'Low', 'Medium', 'High', 'Critical'],

  // 已知社区用户地址（用于奖励公告栏）
  KNOWN_COMMUNITY: [
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // 地址3 社区用户A
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // 地址4 社区用户B
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', // 地址10 社区用户C
  ],
};

// --- 网络检测与地址加载 ---

let _configLoaded = false;
let _currentChainId = null;

/**
 * 获取 MetaMask 当前的 chainId（十进制）
 */
async function getCurrentChainId() {
  if (_currentChainId) return _currentChainId;
  if (!window.ethereum) return CONFIG.CHAIN_ID_DEC;
  try {
    var chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    _currentChainId = parseInt(chainIdHex, 16);
    return _currentChainId;
  } catch (e) {
    return CONFIG.CHAIN_ID_DEC;
  }
}

/**
 * 更新 CONFIG 为指定网络
 */
function applyNetworkConfig(chainIdDec) {
  var net = CONFIG.NETWORKS[chainIdDec];
  if (!net) {
    console.warn('不支持的链ID:', chainIdDec, '使用默认本地配置');
    chainIdDec = 31337;
    net = CONFIG.NETWORKS[31337];
  }
  CONFIG.CHAIN_ID_DEC = chainIdDec;
  CONFIG.CHAIN_ID = net.hexId;
  CONFIG.RPC_URL = net.rpcUrl;
  CONFIG.NETWORK_NAME = net.name;
  _currentChainId = chainIdDec;
  console.log('网络已设置为:', net.name, '(chainId:', chainIdDec, ')');
  return net;
}

/**
 * 从后端加载合约地址（自动检测当前网络）
 */
async function loadContractAddresses(chainIdDec) {
  if (_configLoaded) return true;

  if (!chainIdDec) {
    chainIdDec = await getCurrentChainId();
  }

  // 应用网络配置
  applyNetworkConfig(chainIdDec);

  try {
    var url = CONFIG.API_BASE + '/contract-addresses?chain_id=' + chainIdDec;
    var res = await fetch(url);
    if (res.ok) {
      var data = await res.json();
      if (data.audit_dao_address) CONFIG.AUDIT_DAO_ADDRESS = data.audit_dao_address;
      if (data.ceat_token_address) CONFIG.CEAT_TOKEN_ADDRESS = data.ceat_token_address;
      if (data.team_manager_address) CONFIG.TEAM_MANAGER_ADDRESS = data.team_manager_address;
      _configLoaded = true;
      console.log('合约地址已从后端加载 (chainId=' + chainIdDec + '):', {
        DAO: CONFIG.AUDIT_DAO_ADDRESS,
        CEAT: CONFIG.CEAT_TOKEN_ADDRESS,
        TM: CONFIG.TEAM_MANAGER_ADDRESS
      });
      return true;
    }
    console.warn('后端返回非 200:', res.status);
  } catch (e) {
    console.warn('无法从后端加载合约地址，使用默认值:', e.message);
  }
  return false;
}

function isConfigLoaded() {
  return _configLoaded;
}

/**
 * 重置配置缓存（网络切换后调用）
 */
function resetConfigCache() {
  _configLoaded = false;
  _currentChainId = null;
}

// --- 链切换工具 ---

function getChainConfig(chainId) {
  if (chainId === 31337 || chainId === '0x7a69') {
    var net = CONFIG.NETWORKS[31337];
    return {
      chainId: net.hexId,
      chainIdDec: 31337,
      chainName: net.name,
      rpcUrl: net.rpcUrl,
      explorerUrl: net.explorerUrl,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
    };
  }
  if (chainId === 11155111 || chainId === '0xaa36a7') {
    var net2 = CONFIG.NETWORKS[11155111];
    return {
      chainId: net2.hexId,
      chainIdDec: 11155111,
      chainName: net2.name,
      rpcUrl: net2.rpcUrl,
      explorerUrl: net2.explorerUrl,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
    };
  }
  if (chainId === 1 || chainId === '0x1') {
    return {
      chainId: '0x1',
      chainIdDec: 1,
      chainName: 'Ethereum Mainnet',
      rpcUrl: 'https://ethereum-rpc.publicnode.com',
      explorerUrl: 'https://etherscan.io',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
    };
  }
  return null;
}

async function switchToChain(chainIdDec) {
  var config = getChainConfig(chainIdDec);
  if (!config) throw new Error('不支持的链ID: ' + chainIdDec);
  if (!window.ethereum) throw new Error('请安装 MetaMask');

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: config.chainId }]
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: config.chainId,
          chainName: config.chainName,
          rpcUrls: [config.rpcUrl],
          nativeCurrency: config.nativeCurrency,
          blockExplorerUrls: [config.explorerUrl]
        }]
      });
    } else {
      throw e;
    }
  }
  // 切换后更新配置
  applyNetworkConfig(chainIdDec);
  resetConfigCache();
}

// --- 风险选择 UI ---

function selectRisk(risk) {
  window.__selectedRisk = risk;
  window.selectedRisk = risk;
  var options = document.querySelectorAll('.risk-option');
  options.forEach(function(opt) { opt.classList.remove('selected'); });
  var selected = document.querySelector('.risk-option.' + risk);
  if (selected) { selected.classList.add('selected'); }
}
