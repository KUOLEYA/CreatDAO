function $(id) {
  return document.getElementById(id);
}

function showPending(id, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg pending';
  el.innerHTML = '<span class="spinner"></span> ' + (text || '处理中...');
}

function showSuccess(id, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg success';
  el.innerHTML = '<span style="flex-shrink:0;">✓</span> ' + (text || '操作成功');
}

function showError(id, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg error';
  const errorText = (typeof text === 'object')
    ? (text.message || text.reason || JSON.stringify(text, null, 2))
    : String(text || '操作失败');
  el.innerHTML = '<span style="flex-shrink:0;">✗</span> ' + errorText.slice(0, 500);
}

function showInfo(id, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg info';
  el.innerHTML = '<span style="flex-shrink:0;">ℹ</span> ' + (text || '');
}

function clearMsg(id) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg';
  el.innerHTML = '';
}

function showMessage(id, type, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg ' + type;
  el.innerHTML = text;
}

function validateHex(hash) {
  if (!hash) return false;
  const clean = hash.replace('0x', '');
  return /^[0-9a-fA-F]{64}$/.test(clean);
}

function ensureHexPrefix(hash) {
  if (!hash) return '';
  return hash.startsWith('0x') ? hash : '0x' + hash;
}

function getShortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function updateWalletStatusUI(statusElId, label, dotClass) {
  const el = $(statusElId);
  if (!el) return;
  el.innerHTML = '<span class="dot-indicator ' + (dotClass || 'dot-offline') + '"></span> ' + (label || '未连接');
}

async function switchToSepolia() {
  if (!window.ethereum) throw new Error('MetaMask not installed');
  const chainId = '0xaa36a7';
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId,
          chainName: 'Sepolia Testnet',
          rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          blockExplorerUrls: ['https://sepolia.etherscan.io']
        }]
      });
    } else {
      throw e;
    }
  }
}

function handleContractError(e) {
  if (e.code === 4001 || (e.message && (e.message.toLowerCase().includes('user rejected') || e.message.toLowerCase().includes('cancelled')))) {
    return { type: 'cancelled', text: '&#128184; 已取消操作' };
  }
  var txt = e.reason || e.message || String(e);
  if (txt.includes('execution reverted')) {
    if (txt.includes('Insufficient stake') || txt.includes('must stake')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 质押数量不足，请确保质押至少 600 CEAT' };
    }
    if (txt.includes('Invalid status') || txt.includes('Not in community review')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 提案不在投票阶段，请先在管理端开启投票' };
    }
    if (txt.includes('Voting has ended')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 投票已结束' };
    }
    if (txt.includes('Already voted')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 您已经投过票了' };
    }
    if (txt.includes('Invalid proposal hash') || txt.includes('hash already submitted')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 方案哈希无效或已存在，不能重复提交' };
    }
    if (txt.includes('cannot be zero') || txt.includes('cannot be all zeros')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 哈希不能为空或全零' };
    }
    if (txt.includes('identical to the codeHash')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 不能提交与代码哈希相同的方案' };
    }
    if (txt.includes('Transfer failed') || txt.includes('transferFrom')) {
      return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 转账失败，请确认余额和授权' };
    }
    return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> 合约拒绝: ' + txt.slice(0, 160) };
  }
  if (txt.includes('rate limit') || txt.includes('429') || txt.includes('too many requests')) {
    return { type: 'error', text: '<span style="flex-shrink:0;">&#9203;</span> RPC 限流 (429)，请等待 30 秒后重试' };
  }
  if (txt.includes('could not detect network') || txt.includes('network changed')) {
    return { type: 'error', text: '<span style="flex-shrink:0;">&#127760;</span> 网络切换中，请在 MetaMask 中确认当前网络为 Sepolia' };
  }
  if (txt.includes('missing response') || txt.includes('CONNECTION ERROR') || txt.includes('Internal JSON')) {
    return { type: 'error', text: '<span style="flex-shrink:0;">&#9888;</span> RPC 连接异常: ' + txt.slice(0, 100) };
  }
  return { type: 'error', text: '<span style="flex-shrink:0;">&#10060;</span> ' + txt.slice(0, 200) };
}

function showContractError(id, e) {
  var result = handleContractError(e);
  var el = $(id);
  if (!el) return;
  if (result.type === 'cancelled') {
    el.className = 'msg';
    el.innerHTML = result.text;
  } else {
    el.className = 'msg error';
    el.innerHTML = result.text;
  }
}

// --- 网络切换功能（network-pill） ---

function toggleNetworkDropdown(event) {
  event.stopPropagation();
  var dd = document.getElementById('networkDropdown');
  dd.classList.toggle('show');
  if (dd.classList.contains('show')) {
    setTimeout(function() {
      document.addEventListener('click', function closeDropdown() {
        dd.classList.remove('show');
        document.removeEventListener('click', closeDropdown);
      }, { once: true });
    }, 100);
  }
}

async function switchNetworkTo(chainIdDec) {
  var dd = document.getElementById('networkDropdown');
  dd.classList.remove('show');
  try {
    document.getElementById('networkPillLabel').textContent = '切换中...';
    if (typeof Wallet !== 'undefined' && Wallet.isConnected && Wallet.isConnected()) {
      await Wallet.switchNetwork(chainIdDec === 31337 ? 'local' : 'sepolia');
    } else {
      await switchToChain(chainIdDec);
      applyNetworkConfig(chainIdDec);
      resetConfigCache();
      await loadContractAddresses(chainIdDec);
    }
    updateNetworkPill();
  } catch (e) {
    console.error('网络切换失败:', e);
    alert('网络切换失败: ' + (e.message || e));
    updateNetworkPill();
  }
}

async function updateNetworkPill() {
  var pill = document.getElementById('networkPill');
  var label = document.getElementById('networkPillLabel');
  if (!pill || !label) return;
  try {
    var info;
    if (typeof Wallet !== 'undefined' && Wallet.getCurrentNetworkInfo) {
      info = await Wallet.getCurrentNetworkInfo();
    } else {
      info = {
        chainId: CONFIG.CHAIN_ID_DEC || 31337,
        isLocal: (CONFIG.CHAIN_ID_DEC || 31337) === 31337,
        isSepolia: (CONFIG.CHAIN_ID_DEC || 31337) === 11155111,
        networkName: (CONFIG.CHAIN_ID_DEC || 31337) === 31337 ? 'Local (31337)' : 'Sepolia'
      };
    }
    pill.className = 'network-pill';
    if (info.isLocal) {
      pill.classList.add('local');
      label.textContent = info.networkName || 'Hardhat Local';
    } else if (info.isSepolia) {
      pill.classList.add('sepolia');
      label.textContent = info.networkName || 'Sepolia Testnet';
    } else {
      pill.classList.add('unknown');
      label.textContent = info.networkName || 'Unknown';
    }
  } catch (e) {
    pill.className = 'network-pill';
    if ((CONFIG.CHAIN_ID_DEC || 31337) === 31337) {
      pill.classList.add('local');
      label.textContent = 'Hardhat Local';
    } else {
      pill.classList.add('sepolia');
      label.textContent = 'Sepolia Testnet';
    }
  }
}
