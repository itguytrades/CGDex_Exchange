
//  To run
//  npx hardhat run --network localhost scripts/2_seed-exchange.js


const config = require('../src/config.json')

const tokens = (n) => {
  return ethers.utils.parseUnits(n.toString(), 'ether')
}

const wait = (seconds) => {
  const milliseconds = seconds * 1000
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function main() {
   // Fetch accounts from wallet
   const accounts = await ethers.getSigners()


   // Fetch network
   const {chainId} = await ethers.provider.getNetwork()
   console.log("Using chainID: ", chainId)

   // Fetch deployed tokens
   const DApp = await ethers.getContractAt('Token', config[chainId].DApp.address)
   console.log(`Dapp Token fetched: ${DApp.address}\n`)

   const mETH = await ethers.getContractAt('Token', config[chainId].mETH.address)
   console.log(`mETH fetched: ${mETH.address}\n`)

   const mDAI = await ethers.getContractAt('Token', config[chainId].mDAI.address)
   console.log(`mDAI fetched: ${mDAI.address}\n`)

   const exchange = await ethers.getContractAt('Exchange', config[chainId].exchange.address)
   console.log(`Exchange fetched: ${exchange.address}\n`)

   // Give tokens to account [1]
   const sender = accounts[0]
   const receiver = accounts[1]
   let amount = tokens(10000)


   // user1 transfers 10,000 mETH
   let transaction, result
   transaction = await mETH.connect(sender).transfer(receiver.address,amount)
   console.log(`Transferred ${amount} mETH tokens from ${sender.address} to ${receiver.address}\n`)

   // Set up exchange users
   const user1 = accounts[0]
   const user2 = accounts[1]
   amount = tokens(1000)

   // user1 approves 10,000 Dapp
   transaction = await DApp.connect(user1).approve(exchange.address, amount)
   await transaction.wait()
   console.log(`Approved ${amount} DAPP tokens from ${user1.address}\n`)

   // user1 deposits 10,000 Dapp
   transaction = await exchange.connect(user1).depositToken(DApp.address, amount)
   await transaction.wait()
   console.log(`Deposited ${amount} DAPP tokens from ${user1.address}\n`)

   // User2 approves mETH
   transaction = await mETH.connect(user2).approve(exchange.address, amount)
   await transaction.wait()
   console.log(`Approved ${amount} mETH tokens from ${user2.address}\n`)

   // user2 deposits 10,000 mETH
   transaction = await exchange.connect(user2).depositToken(mETH.address, amount)
   await transaction.wait()
   console.log(`Deposited ${amount} mETH tokens from ${user2.address}\n`)

  

   //////////////////////////////////////////////////
   // Seed a Cancelled Order
   //

   // User 1 makes order to get tokens
   let orderId
   transaction = await exchange.connect(user1).makeOrder(mETH.address, tokens(100), DApp.address, tokens(5))
   result = await transaction.wait()
//   console.log(result)
   console.log(`Made order from ${user1.address}`)

   orderId = result.events[0].args.id
   transaction = await exchange.connect(user1).cancelOrder(orderId)
   result = await transaction.wait()
   console.log(`Cancelled order from ${user1.address}\n`)

    await wait(1)

////////////////////////////////////////////
    // Seed Filled Orders
    //

    // User 1 makes order
   transaction = await exchange.connect(user1).makeOrder(mETH.address, tokens(100), DApp.address, tokens(10))
   result = await transaction.wait()
   console.log(`Made order from ${user1.address}\n`)

   orderId = result.events[0].args.id
   transaction = await exchange.connect(user2).fillOrder(orderId)
   result = await transaction.wait()
   console.log(`Filled order from ${user1.address}\n`)

   await wait(1)

   transaction = await exchange.connect(user1).makeOrder(mETH.address, tokens(50), DApp.address, tokens(15))
   result = await transaction.wait()
   console.log(`Made order from ${user1.address}\n`)

   orderId = result.events[0].args.id
   transaction = await exchange.connect(user2).fillOrder(orderId)
   result = await transaction.wait()
   console.log(`Filled order from ${user1.address}\n`)

   await wait(1)

   transaction = await exchange.connect(user1).makeOrder(mETH.address, tokens(200), DApp.address, tokens(20))
   result = await transaction.wait()
   console.log(`Made order from ${user1.address}\n`)

   orderId = result.events[0].args.id
   transaction = await exchange.connect(user2).fillOrder(orderId)
   result = await transaction.wait()
   console.log(`Filled order from ${user1.address}\n`)

   await wait(1)

   ////////////////////////////////////
   //  Seed open orders
   //

   //  User 1 makes orders

   for(let i = 1; i <= 10; i++) {
    transaction = await exchange.connect(user1).makeOrder(mETH.address, tokens(10 * i), DApp.address, tokens(10))
    result = await transaction.wait()

    console.log(`Made order from ${user1.address}`)

    await wait(1)
   }
   //  User 2 makes orders

   for(let i = 1; i <= 10; i++) {
    transaction = await exchange.connect(user2).makeOrder(DApp.address, tokens(10), mETH.address, tokens(10 * i))
    result = await transaction.wait()

    console.log(`Made order from ${user2.address}`)

    await wait(1)
   }
   

}

main()
 .then(() => process.exit(0))
 .catch((error) => {
  console.error(error);
  process.error(1);
 });