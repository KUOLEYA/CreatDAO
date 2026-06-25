const mockProvider = `
(function() {
  if (window.ethereum) return;

  const ADMIN_ADDRESS = '0xE3bdE49dA9E2506398Dc3600f65e082C54408048';
  const ADMIN_PRIVATE_KEY = '4f9f0f803ed6e92df86b951d9d7ac1e2779e143d881437d1ed4e0c7e245b8eb7';
  
  let currentChainId = '0xaa36a7';
  let selectedAddress = null;
  let accounts = [];
  let isConnected = false;

  const listeners = {};

  function emit(eventName, data) {
    (listeners[eventName] || []).forEach(fn => {
      try { fn(data); } catch(e) {}
    });
  }

  window.ethereum = {
    isMetaMask: true,
    isConnected: () => isConnected,
    chainId: currentChainId,
    selectedAddress: null,
    
    request: async function({ method, params }) {
      console.log('[MockProvider] request:', method, params);

      switch (method) {
        case 'eth_requestAccounts':
          accounts = [ADMIN_ADDRESS];
          selectedAddress = ADMIN_ADDRESS;
          isConnected = true;
          window.ethereum.selectedAddress = ADMIN_ADDRESS;
          emit('accountsChanged', [ADMIN_ADDRESS]);
          emit('connect', { chainId: currentChainId });
          return [ADMIN_ADDRESS];

        case 'eth_accounts':
          if (isConnected && accounts.length > 0) {
            return accounts;
          }
          return [];

        case 'eth_chainId':
          return currentChainId;

        case 'wallet_switchEthereumChain':
          currentChainId = params[0].chainId;
          window.ethereum.chainId = currentChainId;
          emit('chainChanged', currentChainId);
          return null;

        case 'wallet_addEthereumChain':
          currentChainId = params[0].chainId;
          window.ethereum.chainId = currentChainId;
          emit('chainChanged', currentChainId);
          return null;

        case 'eth_getBalance':
          return '0x1BC16D674EC80000';

        case 'eth_call':
        case 'eth_estimateGas':
          return '0x';

        case 'eth_sendTransaction':
          return '0x' + '1'.repeat(64);

        case 'eth_getTransactionReceipt':
          return { status: '0x1', blockNumber: '0x1' };

        case 'eth_blockNumber':
          return '0x' + (Math.floor(Date.now() / 1000)).toString(16);

        case 'eth_gasPrice':
          return '0x3B9ACA00';

        case 'net_version':
          return '11155111';

        case 'personal_sign':
        case 'eth_sign':
          return '0x' + '2'.repeat(130);

        default:
          console.log('[MockProvider] unhandled method:', method);
          return null;
      }
    },

    on: function(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },

    removeListener: function(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(f => f !== fn);
    },

    removeAllListeners: function() {
      Object.keys(listeners).forEach(k => delete listeners[k]);
    },

    enable: async function() {
      return await window.ethereum.request({ method: 'eth_requestAccounts' });
    },

    send: async function(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        const result = await window.ethereum.request({ method: methodOrPayload, params: paramsOrCallback });
        if (typeof paramsOrCallback === 'function') {
          paramsOrCallback(null, { id: 1, jsonrpc: '2.0', result });
        }
        return result;
      }
      return null;
    },

    sendAsync: function(payload, callback) {
      window.ethereum.request({ method: payload.method, params: payload.params })
        .then(result => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch(err => callback(err));
    },

    _metamask: {
      isUnlocked: () => true,
      isApproved: () => true,
    }
  };

  window._ethereumMock = {
    adminAddress: ADMIN_ADDRESS,
    adminKey: ADMIN_PRIVATE_KEY,
    connect: () => window.ethereum.request({ method: 'eth_requestAccounts' }),
    disconnect: () => {
      accounts = [];
      selectedAddress = null;
      isConnected = false;
      window.ethereum.selectedAddress = null;
      emit('accountsChanged', []);
      emit('disconnect', null);
    }
  };

  console.log('[MockProvider] injected. Press MetaMask connection will be auto-approved.');
  console.log('[MockProvider] Account:', ADMIN_ADDRESS);

  dispatchEvent(new Event('ethereum#initialized'));
})();
`;

module.exports = { mockProvider };
