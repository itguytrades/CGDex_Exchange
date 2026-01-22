import { useSelector, useDispatch } from 'react-redux'
import Blockies from 'react-blockies'

import logo from '../assets/CGDev.png'
import eth from '../assets/eth.svg'

import { loadAccount } from '../store/interactions'
import config from '../config.json'

const LOCALHOST_CHAIN_IDS = [31337, 1337]
const BASE_SEPOLIA_CHAIN_ID = 84532

const Navbar = () => {
  const provider = useSelector(state => state.provider.connection)
  const chainId = useSelector(state => state.provider.chainId)
  const account = useSelector(state => state.provider.account)
  const balance = useSelector(state => state.provider.balance)

  const dispatch = useDispatch()

  const connectHandler = async () => {
    if (!provider) return
    try {
      await loadAccount(provider, dispatch)
    } catch (err) {
      console.warn('Wallet connect failed:', err)
    }
  }

  const networkHandler = async (e) => {
    const target = e.target.value
    if (!window.ethereum || !target) return

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${Number(target).toString(16)}` }]
      })
    } catch (err) {
      console.warn('Network switch failed:', err)
    }
  }

  // Controlled select value (MUST match option values)
  const selectValue = LOCALHOST_CHAIN_IDS.includes(chainId)
    ? String(LOCALHOST_CHAIN_IDS[0])
    : chainId === BASE_SEPOLIA_CHAIN_ID
    ? String(BASE_SEPOLIA_CHAIN_ID)
    : ''

  const explorerBase =
    config?.[chainId]?.explorerUrl ||
    config?.[chainId]?.explorerURL ||
    '#'

  const shortAccount = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : ''

  return (
    <div className='exchange__header grid'>
      {/* BRAND */}
      <div className='exchange__header--brand flex'>
        <img src={logo} className='logo' alt='CGDev logo' />
        <h1>CGDex Token Exchange</h1>
      </div>

      {/* NETWORK */}
      <div className='exchange__header--networks flex'>
        <img src={eth} alt='ETH Logo' className='eth-logo' />

        <select
          name='networks'
          id='networks'
          value={selectValue}
          onChange={networkHandler}
        >
          <option value='' disabled>
            Select Network
          </option>

          {/* ALWAYS RENDER BOTH */}
          <option value='31337'>Localhost</option>
          <option value='84532'>Base Sepolia</option>
        </select>
      </div>

      {/* ACCOUNT */}
      <div className='exchange__header--account flex'>
        <p>
          <small>My Balance</small>{' '}
          {balance ? `${Number(balance).toFixed(4)} ETH` : '0 ETH'}
        </p>

        {account ? (
          <a
            href={
              explorerBase !== '#'
                ? `${explorerBase}/address/${account}`
                : '#'
            }
            target='_blank'
            rel='noreferrer'
            title={account}
          >
            {shortAccount}
            <Blockies
              seed={account}
              size={10}
              scale={3}
              color='#2187D0'
              bgColor='#F1F2F9'
              spotColor='#767F92'
              className='identicon'
            />
          </a>
        ) : (
          <button
            className='button'
            onClick={connectHandler}
            disabled={!provider}
          >
            Connect
          </button>
        )}
      </div>
    </div>
  )
}

export default Navbar
