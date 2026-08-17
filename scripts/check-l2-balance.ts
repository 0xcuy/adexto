import { ethers } from "ethers";

async function checkL2Balances() {
  const address = "0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D";
  
  // Base Mainnet
  try {
    const baseProvider = new ethers.JsonRpcProvider("https://base.llamarpc.com");
    const baseBal = await baseProvider.getBalance(address);
    const feeData = await baseProvider.getFeeData();
    console.log(`Base Mainnet (8453) Balance: ${ethers.formatEther(baseBal)} ETH | Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} Gwei`);
  } catch (e: any) {
    console.log("Base check error:", e.message);
  }

  // Arbitrum One
  try {
    const arbProvider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
    const arbBal = await arbProvider.getBalance(address);
    const feeData = await arbProvider.getFeeData();
    console.log(`Arbitrum One (42161) Balance: ${ethers.formatEther(arbBal)} ETH | Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, "gwei")} Gwei`);
  } catch (e: any) {
    console.log("Arb check error:", e.message);
  }
}

checkL2Balances().catch(console.error);
