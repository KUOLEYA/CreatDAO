const CONFIG = {
  API_BASE: (function() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8000/api';
    }
    return '/api';
  })(),

  AUDIT_DAO_ADDRESS: '0x90badefFb1d35B0720c32073E6803a72aA41E005',
  CEAT_TOKEN_ADDRESS: '0x5Ae3d5bDC852D8f88B9ad2dde31bc4721cB6E523',
  MULTISIG_ADDRESS: '0x431eA6ff1EfBD9F03AC910F15E44EC1FDc10194a',
  TEAM_MANAGER_ADDRESS: '0xa2823165Bdab1BFB7C9C0560D39380BD0BF855b3',
  AUDIT_CERTIFICATE_ADDRESS: '0xD112Ad0e4E287Ce31536a7c5955490F0cD3980d0',

  SEPOLIA_CHAIN_ID: '0xaa36a7',
  SEPOLIA_CHAIN_ID_DEC: 11155111,
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
    '争议判断', '二次复核', '委员会裁决', '独立仲裁',
    '已终结'
  ],

  RISK_LEVELS: ['None', 'Low', 'Medium', 'High', 'Critical'],
};

let _configLoaded = false;

async function loadContractAddresses() {
  if (_configLoaded) return;
  try {
    const res = await fetch(CONFIG.API_BASE + '/contract-addresses');
    if (res.ok) {
      const data = await res.json();
      if (data.audit_dao_address) CONFIG.AUDIT_DAO_ADDRESS = data.audit_dao_address;
      if (data.ceat_token_address) CONFIG.CEAT_TOKEN_ADDRESS = data.ceat_token_address;
      _configLoaded = true;
    }
  } catch (e) {
    console.warn('Unable to load contract addresses from backend, using defaults:', e.message);
  }
}

function getChainConfig(chainId) {
  if (chainId === 11155111 || chainId === '0xaa36a7') {
    return {
      chainId: '0xaa36a7',
      chainIdDec: 11155111,
      chainName: 'Sepolia Testnet',
      rpcUrl: CONFIG.SEPOLIA_RPC,
      explorerUrl: CONFIG.SEPOLIA_EXPLORER,
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
  const config = getChainConfig(chainIdDec);
  if (!config) throw new Error('Unsupported chain ID: ' + chainIdDec);
  if (!window.ethereum) throw new Error('MetaMask not installed');
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
}

function selectRisk(risk) {
  window.__selectedRisk = risk;
  const options = document.querySelectorAll('.risk-option');
  options.forEach(function(opt) { opt.classList.remove('selected'); });
  var selected = document.querySelector('.risk-option.' + risk);
  if (selected) { selected.classList.add('selected'); }
}
