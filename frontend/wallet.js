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
    await switchToChain(11155111);
  }

  async function switchNetwork(networkType) {
    var chainIdDec = networkType === 'sepolia' ? 11155111 : 31337;
    await switchToChain(chainIdDec);
    // 切换后重新加载合约地址
    resetConfigCache();
    resetReadProvider();
    await loadContractAddresses(chainIdDec);
    // 重新初始化合约（如果已连接）
    if (_isConnected && _signer) {
      initContracts(_signer);
    }
    return true;
  }

  async function getCurrentNetworkInfo() {
    if (!window.ethereum) return { name: 'Unknown', chainId: 0 };
    try {
      var chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      var chainIdDec = parseInt(chainIdHex, 16);
      var net = CONFIG.NETWORKS[chainIdDec];
      return {
        chainId: chainIdDec,
        networkName: net ? net.name : ('Unknown (' + chainIdDec + ')'),
        isLocal: chainIdDec === 31337,
        isSepolia: chainIdDec === 11155111,
      };
    } catch (e) {
      return { name: 'Unknown', chainId: 0 };
    }
  }

  let _readProvider = null;

  function getReadProvider() {
    // 如果当前是本地网络，直接连接 localhost（rpc-proxy 只支持 Sepolia）
    var isLocal = CONFIG.CHAIN_ID_DEC === 31337;
    var rpcUrl = isLocal ? 'http://127.0.0.1:8545' : (CONFIG.API_BASE + '/rpc-proxy');

    if (_readProvider) {
      // 检查当前缓存的 provider URL 是否匹配
      if (_readProvider.connection && _readProvider.connection.url === rpcUrl) {
        return _readProvider;
      }
    }
    _readProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
    return _readProvider;
  }

  function resetReadProvider() {
    _readProvider = null;
  }

  // --- 统一的钱包 UI 状态更新（覆盖所有页面的不同元素ID） ---

  function updateAllWalletStatuses(state, addrText) {
    // 1. walletStatus 元素（多数页面：dashboard、admin、proposal-writing 等）
    if (state === 'connected') {
      updateWalletStatusUI('walletStatus', '<span class="addr">' + (addrText || '') + '</span>', 'connected');
    } else {
      updateWalletStatusUI('walletStatus', '未连接', 'disconnected');
    }

    // 2. walletBtn（ai-review 页面专用）
    var walletBtn = document.getElementById('walletBtn');
    if (walletBtn) {
      if (state === 'connected') {
        walletBtn.innerHTML = '🟢 ' + (addrText || '已连接');
        walletBtn.style.color = '#81c784';
      } else {
        walletBtn.innerHTML = '🔌 连接钱包';
        walletBtn.style.color = '#81c784';
      }
    }

    // 3. btnConnect（pricing 页面专用）
    var btnConnect = document.getElementById('btnConnect');
    if (btnConnect) {
      btnConnect.textContent = state === 'connected' ? ('🟢 ' + (addrText || '已连接')) : '🔌 连接钱包';
    }

    // 4. connectBtn（多个页面使用，但不覆盖 setCallbacks 已管理的）
    var connectBtn = document.getElementById('connectBtn');
    if (connectBtn && !connectBtn.dataset.callbackManaged) {
      if (state === 'connected') {
        connectBtn.textContent = '已连接';
        connectBtn.disabled = true;
      } else {
        connectBtn.textContent = '连接钱包';
        connectBtn.disabled = false;
      }
    }
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
      updateAllWalletStatuses('connected', short);
      refreshNetworkBadge();

      if (_onConnect) _onConnect(_userAddress, _signer, _contracts);
      return true;
    } catch (e) {
      console.error('钱包初始化失败:', e);
      updateAllWalletStatuses('disconnected');
      return false;
    }
  }

  async function connect() {
    if (!window.ethereum) {
      alert('请安装 MetaMask 浏览器扩展!');
      return false;
    }
    await switchToChain(CONFIG.CHAIN_ID_DEC);
    var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      alert('请在 MetaMask 中选择一个账户');
      return false;
    }
    // 尝试加载合约地址（失败不影响连接）
    try { await loadContractAddresses(); } catch (e) { console.warn('加载合约地址失败（不影响钱包连接）:', e.message); }
    return initWithAccount(accounts[0]);
  }

  function disconnect() {
    _isConnected = false;
    _signer = null;
    _provider = null;
    _userAddress = null;
    _contracts = {};
    resetReadProvider();
    updateAllWalletStatuses('disconnected');
    updateNetworkBadge(null);
    if (_onDisconnect) _onDisconnect();
  }

  // --- 通用的钱包按钮点击处理（所有页面统一使用） ---
  async function handleWalletClick() {
    var btn = document.getElementById('walletBtn');
    if (!btn) return;
    if (_isConnected) {
      disconnect();
      btn.innerHTML = '🔌 连接钱包';
      btn.style.color = '#81c784';
    } else {
      btn.disabled = true;
      btn.innerHTML = '⏳ 连接中...';
      btn.style.color = '#ffb74d';
      try {
        var ok = await connect();
        if (ok) {
          btn.innerHTML = '🟢 ' + getShortAddr(_userAddress);
          btn.style.color = '#81c784';
        } else {
          btn.innerHTML = '🔌 连接钱包';
          btn.style.color = '#81c784';
        }
      } catch (e) {
        console.error('钱包连接失败:', e);
        btn.innerHTML = '🔌 连接钱包';
        btn.style.color = '#81c784';
      } finally {
        btn.disabled = false;
      }
    }
  }

  // --- 网络徽章更新 ---
  function updateNetworkBadge(networkInfo) {
    var badge = document.getElementById('networkBadge');
    if (badge) {
      if (!networkInfo && _isConnected) {
        getCurrentNetworkInfo().then(function(info) {
          if (info.chainId > 0) {
            badge.textContent = (info.isLocal ? '🏠 ' : '🌐 ') + info.networkName;
            badge.style.display = 'inline-flex';
          } else {
            badge.style.display = 'none';
          }
        }).catch(function() {
          badge.style.display = 'none';
        });
      } else if (networkInfo) {
        badge.textContent = (networkInfo.isLocal ? '🏠 ' : '🌐 ') + networkInfo.networkName;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
    // 同时更新 network-pill（如果页面使用了）
    if (typeof updateNetworkPill === 'function') {
      updateNetworkPill();
    }
  }

  async function refreshNetworkBadge() {
    if (!_isConnected) return;
    try {
      var info = await getCurrentNetworkInfo();
      updateNetworkBadge(info);
    } catch (e) {}
  }

  function registerEvents() {
    window.ethereum?.on('accountsChanged', function(accounts) {
      if (accounts.length === 0) {
        disconnect();
      } else {
        window.location.reload();
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
        // 尝试加载合约地址（失败不影响连接）
        try { await loadContractAddresses(); } catch (e) { console.warn('加载合约地址失败（不影响钱包连接）:', e.message); }
        var accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0 && !_userAddress) {
          initWithAccount(accounts[0]);
        }
      } catch (e) {
        console.log('自动连接钱包失败:', e);
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
    handleWalletClick: handleWalletClick,
    updateNetworkBadge: updateNetworkBadge,
    refreshNetworkBadge: refreshNetworkBadge,
    switchToSepolia: switchToSepolia,
    switchNetwork: switchNetwork,
    getCurrentNetworkInfo: getCurrentNetworkInfo,
    registerEvents: registerEvents,
    autoConnect: autoConnect
  };
})();
