const Wallet = (function() {
  let _signer = null;
  let _provider = null;
  let _userAddress = null;
  let _isConnected = false;
  let _contracts = {};
  let _onConnect = null;
  let _onDisconnect = null;

  function getSigner() { return _signer; }
  function getProvider() { return _provider; }
  function getAddress() { return _userAddress; }
  function isConnected() { return _isConnected; }
  function getContracts() { return _contracts; }

  function setCallbacks(onConnect, onDisconnect) {
    _onConnect = onConnect;
    _onDisconnect = onDisconnect;
  }

  async function switchToSepolia() {
    if (!window.ethereum) throw new Error('请安装 MetaMask 浏览器扩展!');
    let currentChain = await window.ethereum.request({ method: 'eth_chainId' }).catch(function() { return ''; });
    if (currentChain !== CONFIG.SEPOLIA_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: CONFIG.SEPOLIA_CHAIN_ID }]
        });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: CONFIG.SEPOLIA_CHAIN_ID,
              chainName: 'Sepolia',
              rpcUrls: [CONFIG.SEPOLIA_RPC].concat(CONFIG.SEPOLIA_RPC_BACKUPS || []),
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
            }]
          });
        } else {
          throw e;
        }
      }
    }
  }

  let _readProvider = null;

  function getReadProvider() {
    if (_readProvider) return _readProvider;
    _readProvider = new ethers.providers.JsonRpcProvider(CONFIG.API_BASE + '/rpc-proxy');
    return _readProvider;
  }

  function initContracts(signer) {
    var readProvider = getReadProvider();
    var readDAO = new ethers.Contract(CONFIG.AUDIT_DAO_ADDRESS, ContractDefs.auditDAO_ABI, readProvider);

    _contracts.auditDAO = new ethers.Contract(
      CONFIG.AUDIT_DAO_ADDRESS, ContractDefs.auditDAO_ABI, signer
    );
    _contracts.ceatToken = new ethers.Contract(
      CONFIG.CEAT_TOKEN_ADDRESS, ContractDefs.ceatToken_ABI, signer
    );
    readDAO.teamManager().then(function(tmAddr) {
      _contracts.teamManager = new ethers.Contract(tmAddr, ContractDefs.teamManager_ABI, signer);
    }).catch(function(e) {
      console.error('初始化团队管理器失败:', e);
    });
  }

  function initWithAccount(addr) {
    try {
      _provider = new ethers.providers.Web3Provider(window.ethereum);
      _signer = _provider.getSigner();
      _userAddress = addr;
      _isConnected = true;

      initContracts(_signer);

      var short = getShortAddr(_userAddress);
      updateWalletStatusUI('walletStatus', '<span class="addr">' + short + '</span>', 'connected');

      if (_onConnect) _onConnect(_userAddress, _signer, _contracts);
      return true;
    } catch (e) {
      console.error('钱包初始化失败:', e);
      updateWalletStatusUI('walletStatus', '&#10060; 初始化失败', 'disconnected');
      return false;
    }
  }

  async function connect() {
    if (!window.ethereum) {
      alert('请安装 MetaMask 浏览器扩展!');
      return false;
    }
    await switchToSepolia();
    var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      alert('请在 MetaMask 中选择一个账户');
      return false;
    }
    return initWithAccount(accounts[0]);
  }

  function disconnect() {
    _isConnected = false;
    _signer = null;
    _provider = null;
    _userAddress = null;
    _contracts = {};
    updateWalletStatusUI('walletStatus', '未连接', 'disconnected');
    if (_onDisconnect) _onDisconnect();
  }

  function registerEvents() {
    window.ethereum?.on('accountsChanged', function(accounts) {
      if (accounts.length === 0) {
        disconnect();
      } else {
        initWithAccount(accounts[0]);
      }
    });
    window.ethereum?.on('chainChanged', function() {
      window.location.reload();
    });
    window.ethereum?.on('disconnect', function() {
      disconnect();
    });
  }

  async function autoConnect() {
    if (window.ethereum) {
      try {
        var accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0 && !_userAddress) {
          initWithAccount(accounts[0]);
        }
      } catch (e) {
        console.log('Auto connect wallet failed:', e);
      }
    }
  }

  return {
    getSigner: getSigner,
    getProvider: getProvider,
    getAddress: getAddress,
    isConnected: isConnected,
    getContracts: getContracts,
    setCallbacks: setCallbacks,
    connect: connect,
    disconnect: disconnect,
    initWithAccount: initWithAccount,
    switchToSepolia: switchToSepolia,
    registerEvents: registerEvents,
    autoConnect: autoConnect
  };
})();
