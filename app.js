// app.js - 多链地址器逻辑（纯前端）
// 依赖（通过 CDN 在 index.html 中引入）:
// - bip39, bip32, bitcoinjs, ethers, TronWeb, qrcode

(() => {
  // DOM
  const modeEl = document.getElementById('mode');
  const strengthEl = document.getElementById('strength');
  const accountIndexEl = document.getElementById('accountIndex');
  const generateBtn = document.getElementById('generateBtn');
  const cardsEl = document.getElementById('cards');
  const showPrivateToggle = document.getElementById('showPrivateToggle');
  const exportBtn = document.getElementById('exportBtn');
  const usdtNetworkEl = document.getElementById('usdtNetwork');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const generatedAtEl = document.getElementById('generatedAt');

  // 初始 UI 行为
  modeEl.addEventListener('change', () => {
    document.getElementById('mnemonicStrengthLabel').style.display = modeEl.value === 'mnemonic' ? 'inline-block' : 'none';
  });
  modeEl.dispatchEvent(new Event('change'));

  darkModeToggle.addEventListener('change', () => {
    if (darkModeToggle.checked) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  });

  // 安全确认：在显示私钥/助记词或导出前要确认
  function confirmSensitiveAction(message = '此操作会显示或导出私钥/助记词，可能导致资金被窃取。确认继续？') {
    return confirm(message);
  }

  // 工具函数：复制到剪贴板
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (e) {
      prompt('无法自动复制，请手动复制下面内容：', text);
    }
  }

  // 下载文件
  function downloadFile(filename, content, mime = 'application/json') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }

  // 地址生成主逻辑
  async function generateAll() {
    const mode = modeEl.value;
    const strength = parseInt(strengthEl.value, 10);
    const index = parseInt(accountIndexEl.value || '0', 10);

    let mnemonic = null;
    let seed = null;
    let root = null;
    let rawEthPrivateHex = null;

    if (mode === 'mnemonic') {
      mnemonic = bip39.generateMnemonic(strength);
      seed = await bip39.mnemonicToSeed(mnemonic);
      root = bip32.fromSeed(seed);
    } else {
      // 直接生成随机私钥（32 bytes）
      const rand = new Uint8Array(32);
      crypto.getRandomValues(rand);
      rawEthPrivateHex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
      // 将 raw private key used as eth/tron key. For BTC we can use bip32 from raw seed by wrapping.
      // Build a pseudo-seed for bip32 using raw bytes repeated + zero-padding (simple)
      const seedForBip = new Uint8Array(64);
      seedForBip.set(rand, 0);
      root = bip32.fromSeed(seedForBip);
    }

    // BTC (BIP84 m/84'/0'/0'/0/index) mainnet
    const btcPath = `m/84'/0'/0'/0/${index}`;
    const btcNode = root.derivePath(btcPath);
    const btcPub = btcNode.publicKey;
    const btcNetwork = bitcoin.networks.bitcoin;
    const btcPayment = bitcoin.payments.p2wpkh({ pubkey: btcPub, network: btcNetwork });
    const btcAddress = btcPayment.address;
    const btcPrivateWIF = bitcoin.ECPair.fromPrivateKey ? bitcoin.ECPair.fromPrivateKey(btcNode.privateKey, { network: btcNetwork }).toWIF() : btcNode.toWIF ? btcNode.toWIF() : null;
    const btcPrivHex = btcNode.privateKey ? Buffer.from(btcNode.privateKey).toString('hex') : null;

    // ETH (m/44'/60'/0'/0/index)
    let ethPrivHex;
    let ethAddress;
    if (mode === 'mnemonic') {
      const ethPath = `m/44'/60'/0'/0/${index}`;
      const ethNode = root.derivePath(ethPath);
      ethPrivHex = Buffer.from(ethNode.privateKey).toString('hex');
      const wallet = new ethers.ethers.Wallet('0x' + ethPrivHex);
      ethAddress = wallet.address;
    } else {
      ethPrivHex = rawEthPrivateHex;
      const wallet = new ethers.ethers.Wallet('0x' + ethPrivHex);
      ethAddress = wallet.address;
    }

    // TRON (use private key -> tron address)
    const tronPrivHex = ethPrivHex;
    const tronAddress = TronWeb.address.fromPrivateKey(tronPrivHex);

    // USDT address based on choice
    const usdtChoice = usdtNetworkEl.value;
    const usdtOn = usdtChoice === 'tron' ? tronAddress : ethAddress;

    // 记录时间
    generatedAtEl.textContent = new Date().toLocaleString();

    // 构建结果结构
    const result = {
      generatedAt: new Date().toISOString(),
      mode,
      mnemonic: mnemonic || null,
      accounts: {
        index,
        BTC: {
          path: btcPath,
          address: btcAddress,
          privateHex: btcPrivHex,
          wif: btcPrivateWIF
        },
        ETH: {
          path: mode === 'mnemonic' ? `m/44'/60'/0'/0/${index}` : null,
          address: ethAddress,
          privateHex: ethPrivHex
        },
        TRON: {
          path: mode === 'mnemonic' ? `m/44'/195'/0'/0/${index}` : null,
          address: tronAddress,
          privateHex: tronPrivHex
        },
        USDT: {
          network: usdtChoice,
          address: usdtOn
        }
      }
    };

    renderCards(result);
    return result;
  }

  // 渲染卡片
  function renderCards(data) {
    cardsEl.innerHTML = '';

    const showPrivate = !!showPrivateToggle.checked && confirmSensitiveAction('你将显示私钥/助记词。确认仅在安全、离线环境下继续？');

    const makeCard = (title, subtitle, address, privHex, extra = {}) => {
      const card = document.createElement('section');
      card.className = 'card';

      const h = document.createElement('h2'); h.textContent = title;
      const s = document.createElement('div'); s.className = 'small'; s.textContent = subtitle;

      const addrLabel = document.createElement('div'); addrLabel.className = 'small'; addrLabel.textContent = '地址';
      const addrBox = document.createElement('div'); addrBox.className = 'addressBox'; addrBox.textContent = address;

      const qrWrap = document.createElement('div'); qrWrap.className = 'qr';
      QRCode.toCanvas(address, { width: 104, margin: 0 }, (err, canvas) => {
        if (!err) {
          qrWrap.innerHTML = ''; qrWrap.appendChild(canvas);
        } else {
          qrWrap.textContent = 'QR 生成失败';
        }
      });

      const actions = document.createElement('div'); actions.className = 'actions';
      const copyBtn = document.createElement('button'); copyBtn.className = 'btn'; copyBtn.textContent = '复制地址';
      copyBtn.onclick = () => copyToClipboard(address);

      actions.appendChild(copyBtn);

      // 私钥显示/复制（需要确认）
      let privEl = null;
      if (privHex) {
        privEl = document.createElement('div'); privEl.style.marginTop = '10px';
        if (showPrivate) {
          const keyBox = document.createElement('div'); keyBox.className = 'keyBox'; keyBox.textContent = privHex;
          const cp = document.createElement('button'); cp.className = 'btn'; cp.textContent = '复制私钥';
          cp.onclick = () => copyToClipboard(privHex);
          privEl.appendChild(keyBox); privEl.appendChild(cp);
        } else {
          const masked = document.createElement('div'); masked.className = 'small'; masked.textContent = '私钥已被隐藏（需在控制区勾选并确认显示）';
          privEl.appendChild(masked);
        }
      }

      // 组合元素
      card.appendChild(h);
      card.appendChild(s);

      const contentRow = document.createElement('div'); contentRow.className = 'row';
      const leftCol = document.createElement('div'); leftCol.style.flex = '1';
      leftCol.appendChild(addrLabel); leftCol.appendChild(addrBox);
      const rightCol = document.createElement('div'); rightCol.style.width = '130px'; rightCol.appendChild(qrWrap);

      contentRow.appendChild(leftCol); contentRow.appendChild(rightCol);

      card.appendChild(contentRow);
      card.appendChild(actions);
      if (privEl) card.appendChild(privEl);

      // 额外信息
      if (extra.notes) {
        const note = document.createElement('div'); note.className = 'small'; note.style.marginTop = '8px'; note.textContent = extra.notes;
        card.appendChild(note);
      }

      return card;
    };

    // BTC 卡
    const btc = data.accounts.BTC;
    cardsEl.appendChild(makeCard('Bitcoin (BTC)', `BIP84 ${btc.path} — Bech32`, btc.address, btc.privateHex, { notes: `WIF: ${btc.wif || 'N/A'}` }));

    // ETH 卡
    const eth = data.accounts.ETH;
    cardsEl.appendChild(makeCard('Ethereum (ETH)', eth.path || '私钥直出', eth.address, eth.privateHex, { notes: '用于 ERC-20（含 ERC20 的 USDT）' }));

    // TRON 卡
    const tron = data.accounts.TRON;
    cardsEl.appendChild(makeCard('Tron (TRX)', tron.path || '私钥直出', tron.address, tron.privateHex, { notes: '用于 TRC-20（含 TRC20 的 USDT）' }));

    // USDT 卡（只展示接收地址，取决于选项）
    const usdt = data.accounts.USDT;
    cardsEl.appendChild(makeCard('USDT (接收地址)', `网络: ${usdt.network.toUpperCase()}`, usdt.address, null, { notes: 'USDT 为代币，地址与链相同。' }));
  }

  // 导出 JSON（敏感）
  exportBtn.addEventListener('click', async () => {
    if (!confirmSensitiveAction('导出将包含私钥/助记词（若存在）。确认要导出到本地 JSON 文件？')) return;
    const data = await generateAll();
    downloadFile(`wallet-export-${new Date().toISOString().replace(/[:.]/g,'-')}.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  // 生成按钮
  generateBtn.addEventListener('click', async () => {
    try {
      await generateAll();
    } catch (e) {
      console.error(e);
      alert('生成失败，请检查控制台错误信息。');
    }
  });

  // 页面首次自动生成一个示例（本地演示）
  // 不自动显示私钥（需用户勾选并确认）
  window.addEventListener('load', () => {
    generateBtn.click();
  });

})();
