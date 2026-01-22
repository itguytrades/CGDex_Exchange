import { ethers } from 'ethers'
import TOKEN_ABI from '../abis/Token.json'
import EXCHANGE_ABI from '../abis/Exchange.json'


export const loadProvider = (dispatch) => {
  const connection = new ethers.providers.Web3Provider(window.ethereum)
  dispatch({ type: 'PROVIDER_LOADED', connection })

  return connection
}

export const loadNetwork = async (provider, dispatch) => {
	const { chainId } = await provider.getNetwork()
	dispatch({ type: 'NETWORK_LOADED', chainId })

	return chainId
}
export const loadAccount = async (provider, dispatch) => {
	const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
	const account = ethers.utils.getAddress(accounts[0])

	dispatch({ type: 'ACCOUNT_LOADED', account })

	let balance = await provider.getBalance(account)
	balance = ethers.utils.formatEther(balance)

	dispatch({ type: 'ETHER_BALANCE_LOADED', balance })

	return account
}
export const loadTokens = async (provider, addresses, dispatch) => {
  let token, symbol

  token = new ethers.Contract(addresses[0], TOKEN_ABI, provider)
  symbol = await token.symbol()
  console.log(symbol)
  dispatch({ type: 'TOKEN_1_LOADED', token, symbol })

  token = new ethers.Contract(addresses[1], TOKEN_ABI, provider)
  symbol = await token.symbol()
  dispatch({ type: 'TOKEN_2_LOADED', token, symbol })

  return token
}

export const loadExchange = async (provider, address, dispatch) => {
  const exchange = new ethers.Contract(address, EXCHANGE_ABI, provider);
  dispatch({ type: 'EXCHANGE_LOADED', exchange })

  return exchange
}

export const subscribeToEvents = (exchange, dispatch) => {
  exchange.on('Cancel', (id, user, tokenGet, amountGet, tokenGive, amountGive, timestamp, event) => {
    const order = event.args
    dispatch({ type: 'ORDER_CANCEL_SUCCESS', order, event })
  })
  exchange.on('Trade', (id, user, tokenGet, amountGet, tokenGive, amountGive, creator, timestamp, event) => {
    const order = event.args
    dispatch({ type: 'ORDER_FILL_SUCCESS', order, event })
  })
  exchange.on('Deposit', (token, user, amount, balance, event) => {
    dispatch({ type: 'TRANSFER_SUCCESS', event })
  })
  exchange.on('Withdraw', (token, user, amount, balance, event) => {
    dispatch({ type: 'TRANSFER_SUCCESS', event })
  })
  exchange.on('Order', (id, user, tokenGet, amountGet, tokenGive, amountGive, timestamp, event) => {
    const order = event.args
    dispatch({ type: 'NEW_ORDER_SUCCESS', order, event })
  }) 
}

//--------------------------------
// LOAD USER BALANCEES

export const loadBalances = async (exchange, tokens, account, dispatch) => {

  let balance = ethers.utils.formatUnits(await tokens[0].balanceOf(account), 18)
  dispatch({ type: 'TOKEN_1_BALANCE_LOADED', balance })

  balance = ethers.utils.formatUnits(await tokens[1].balanceOf(account), 18)
  dispatch({ type: 'TOKEN_2_BALANCE_LOADED', balance })

  balance = ethers.utils.formatUnits(await exchange.balanceOf(tokens[0].address, account), 18)
  dispatch({ type: 'EXCHANGE_TOKEN_1_BALANCE_LOADED', balance })

  balance = ethers.utils.formatUnits(await exchange.balanceOf(tokens[1].address, account), 18)
  dispatch({ type: 'EXCHANGE_TOKEN_2_BALANCE_LOADED', balance }) 
}

// ------------------------------------------------------------------------------
// LOAD ALL ORDERS

export const loadAllOrders = async (provider, exchange, dispatch, fromBlockOverride) => {
  dispatch({ type: 'ORDERS_LOADING' }); // optional if you have it

console.log("fromBlockOverride: ", fromBlockOverride)


  try {
    const latestBlock = await provider.getBlockNumber();

    // IMPORTANT: set a sane start block (deployment block)
    const startBlock =
      fromBlockOverride ??
      exchange?.deploymentBlock ?? // if you attach it elsewhere
      0;

    // Most RPCs behave better with 2k–10k block windows.
    // Base Sepolia public RPCs often like ~2000-5000.
    const STEP = 3000;

    const cancelledOrders = [];
    const filledOrders = [];
    const allOrders = [];

    // Use explicit filters (more reliable than passing event name strings)
    const cancelFilter = exchange.filters.Cancel();
    const tradeFilter = exchange.filters.Trade();
    const orderFilter = exchange.filters.Order();

    for (let from = startBlock; from <= latestBlock; from += STEP + 1) {
      const to = Math.min(from + STEP, latestBlock);

      // Optional: progress dispatch for UI
      dispatch({ type: 'ORDERS_SYNC_PROGRESS', from, to, latestBlock });

      const [cancelChunk, tradeChunk, orderChunk] = await Promise.all([
        exchange.queryFilter(cancelFilter, from, to),
        exchange.queryFilter(tradeFilter, from, to),
        exchange.queryFilter(orderFilter, from, to),
      ]);

      // push args
      cancelledOrders.push(...cancelChunk.map(e => e.args));
      filledOrders.push(...tradeChunk.map(e => e.args));
      allOrders.push(...orderChunk.map(e => e.args));
    }

    dispatch({ type: 'CANCELLED_ORDERS_LOADED', cancelledOrders });
    dispatch({ type: 'FILLED_ORDERS_LOADED', filledOrders });
    dispatch({ type: 'ALL_ORDERS_LOADED', allOrders });

    dispatch({ type: 'ORDERS_LOADED_OK' }); // optional
  } catch (error) {
    console.error('loadAllOrders failed:', error);

    // Nice warning for UI
    dispatch({
      type: 'ORDERS_LOAD_FAILED',
      error: error?.reason || error?.message || 'Failed to load orders from RPC'
    });
  }

};

//-------------------------------
// TRANSFER TOKENS (DEPOSIT & WITHDRAWS)

export const transferTokens =  async (provider, exchange, transferType, token, amount, dispatch) => {
  let transaction

  dispatch({ type: 'TRANSFER_REQUEST' })

  try {
    const signer = await provider.getSigner()
    const amountToTransfer = ethers.utils.parseUnits(amount.toString(), 18)

    if (transferType === 'Deposit') {
      transaction = await token.connect(signer).approve(exchange.address, amountToTransfer)
      await transaction.wait()
      transaction = await exchange.connect(signer).depositToken(token.address, amountToTransfer)
    } else {
      transaction = await exchange.connect(signer).withdrawToken(token.address, amountToTransfer)
    }

    await transaction.wait()

  } catch(error) {
    dispatch({ type: 'TRANSFER_FAIL' })
  }
}

// ------------------------------------------------------------------------------
// ORDERS (BUY & SELL)

export const makeBuyOrder = async (provider, exchange, tokens, order, dispatch) => {
  const tokenGet = tokens[0].address
  const amountGet = ethers.utils.parseUnits(order.amount, 18)
  const tokenGive = tokens[1].address
  const amountGive = ethers.utils.parseUnits((order.amount * order.price).toString(), 18)

  dispatch({ type: 'NEW_ORDER_REQUEST' })

  try {
    const signer = await provider.getSigner()
    const transaction = await exchange.connect(signer).makeOrder(tokenGet, amountGet, tokenGive, amountGive)
    await transaction.wait()
  } catch (error) {
    dispatch({ type: 'NEW_ORDER_FAIL' })
  }
}

export const makeSellOrder = async (provider, exchange, tokens, order, dispatch) => {
  const tokenGet = tokens[1].address
  const amountGet = ethers.utils.parseUnits((order.amount * order.price).toString(), 18)
  const tokenGive = tokens[0].address
  const amountGive = ethers.utils.parseUnits(order.amount, 18)

  dispatch({ type: 'NEW_ORDER_REQUEST' })

  try {
    const signer = await provider.getSigner()
    const transaction = await exchange.connect(signer).makeOrder(tokenGet, amountGet, tokenGive, amountGive)
    await transaction.wait()
  } catch (error) {
    dispatch({ type: 'NEW_ORDER_FAIL' })
  }
}

// ------------------------------------------------------------------------------
// CANCEL ORDER

export const cancelOrder = async (provider, exchange, order, dispatch) => {

  dispatch({ type: 'ORDER_CANCEL_REQUEST' })

  try {
    const signer = await provider.getSigner()
    const transaction = await exchange.connect(signer).cancelOrder(order.id)
    await transaction.wait()
  } catch (error) {
    dispatch({ type: 'ORDER_CANCEL_FAIL' })
  }
}

// ------------------------------------------------------------------------------
// FILL ORDER

export const fillOrder = async (provider, exchange, order, dispatch) => {
  dispatch({ type: 'ORDER_FILL_REQUEST' })

  try {
    const signer = await provider.getSigner()
    const transaction = await exchange.connect(signer).fillOrder(order.id)
    await transaction.wait()
  } catch (error) {
    dispatch({ type: 'ORDER_FILL_FAIL' })
  }
}








