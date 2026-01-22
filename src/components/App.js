import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import config from '../config.json'

import {
  loadProvider,
  loadNetwork,
  loadAccount,
  loadTokens,
  loadExchange,
  loadAllOrders,
  subscribeToEvents
} from '../store/interactions'

import Navbar from './Navbar'
import Markets from './Markets'
import Balance from './Balance'
import Order from './Order'
import OrderBook from './OrderBook'
import PriceChart from './PriceChart'
import Trades from './Trades'
import Transactions from './Transactions'
import Alert from './Alert'

function App() {
  const dispatch = useDispatch()

  // ---- Nice warning/error helper ----
  const notify = (level, message, details) => {
    // level: 'info' | 'warning' | 'error'
    const prefix = `[DApp ${level.toUpperCase()}]`
    if (level === 'error') console.error(prefix, message, details || '')
    else if (level === 'warning') console.warn(prefix, message, details || '')
    else console.log(prefix, message, details || '')

    // OPTIONAL: If you have an alert action, wire it here.
    // Example (replace with your real action):
    // dispatch(setAlert({ level, message }))
    //
    // Keep it commented so it never crashes if the action doesn't exist.
  }

  const isValidAddress = (addr) => typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr)

  const loadBlockchainData = async () => {
    // 0) MetaMask safety
    if (!window.ethereum) {
      notify(
        'warning',
        'No injected provider found. Please install MetaMask (or use a web3-enabled browser).'
      )
      return
    }

    let provider
    try {
      provider = loadProvider(dispatch)
      if (!provider) {
        notify('error', 'Failed to create provider.')
        return
      }
    } catch (err) {
      notify('error', 'Provider initialization threw an error.', err)
      return
    }

    // 1) Network/chain safety
    let chainId
    try {
      chainId = await loadNetwork(provider, dispatch)
      if (!chainId) {
        notify('error', 'Unable to detect network chainId.')
        return
      }
    } catch (err) {
      notify('error', 'Failed to load network/chainId.', err)
      return
    }

    // 2) Config safety for that chain
    const chainConfig = config?.[chainId]
    if (!chainConfig) {
      notify(
        'warning',
        `Unsupported network (chainId: ${chainId}). Please switch to a supported network.`,
        { chainId }
      )
      return
    }

    const CGD = chainConfig?.CGD
    const mETH = chainConfig?.mETH
    const exchangeCfg = chainConfig?.exchange

    if (!isValidAddress(CGD?.address) || !isValidAddress(mETH?.address) || !isValidAddress(exchangeCfg?.address)) {
      notify(
        'error',
        `Missing/invalid contract addresses for chainId ${chainId}. Check config.json.`,
        { chainId, CGD, mETH, exchangeCfg }
      )
      return
    }

    // 3) Account load safety (user can reject, or not connected yet)
    try {
      await loadAccount(provider, dispatch)
    } catch (err) {
      notify(
        'warning',
        'Wallet not connected (or user rejected connection). You can still browse, but trading may be disabled.',
        err
      )
      // Not fatal — continue loading contracts so UI can still render markets/orderbook if your app supports it.
    }

    // 4) Load tokens
    try {
      await loadTokens(provider, [CGD.address, mETH.address], dispatch)
    } catch (err) {
      notify('error', 'Failed to load token contracts.', err)
      return
    }

    // 5) Load exchange
    let exchange
    try {
      exchange = await loadExchange(provider, exchangeCfg.address, dispatch)
      if (!exchange) {
        notify('error', 'Exchange contract returned null/undefined.')
        return
      }
    } catch (err) {
      notify('error', 'Failed to load exchange contract.', err)
      return
    }

    // 6) Load orders (non-fatal if it fails)
    const exchangeConfig = config[chainId].exchange;
    console.log("exchangeConfig: ", exchangeConfig)

    try {
      const fromBlock = exchangeConfig?.deploymentBlock ?? 0;
      console.log("fromBlock: ", fromBlock)
      await loadAllOrders(provider, exchange, dispatch, fromBlock);
    } catch (err) {
      notify(
        'warning',
        'Failed to load orders (RPC may be rate-limiting logs). Try refresh, or switch RPC endpoint.',
        err
      );
    }

    // 7) Subscribe to events (non-fatal if it fails)
    try {
      subscribeToEvents(exchange, dispatch)
    } catch (err) {
      notify('warning', 'Event subscription failed (likely provider/event setup issue).', err)
    }

    notify('info', `Connected on chainId ${chainId}.`)
  }

  useEffect(() => {
    // Run once on mount (your previous code ran every render and re-attached listeners)
    loadBlockchainData()

    // If no MetaMask, no listeners
    if (!window.ethereum) return

    const handleChainChanged = (newChainId) => {
      // If you prefer not to reload, you can call loadBlockchainData() instead.
      notify('info', `Network changed to ${newChainId}. Reloading app...`)
      window.location.reload()
    }

    const handleAccountsChanged = async (accounts) => {
      try {
        const provider = loadProvider(dispatch)
        if (!provider) return

        if (!accounts || accounts.length === 0) {
          notify('warning', 'No accounts found. Please connect a wallet in MetaMask.')
          return
        }

        await loadAccount(provider, dispatch)
        notify('info', `Account changed to ${accounts[0]}`)
      } catch (err) {
        notify('warning', 'Failed handling account change.', err)
      }
    }

    const handleDisconnect = (err) => {
      notify('warning', 'Wallet disconnected.', err)
    }

    window.ethereum.on('chainChanged', handleChainChanged)
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on?.('disconnect', handleDisconnect) // some providers support this

    return () => {
      window.ethereum.removeListener('chainChanged', handleChainChanged)
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener?.('disconnect', handleDisconnect)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])

  return (
    <div>
      <Navbar />

      <main className='exchange grid'>
        <section className='exchange__section--left grid'>
          <Markets />
          <Balance />
          <Order />
        </section>

        <section className='exchange__section--right grid'>
          <PriceChart />
          <Transactions />
          <Trades />
          <OrderBook />
        </section>
      </main>

      <Alert />
    </div>
  )
}

export default App
