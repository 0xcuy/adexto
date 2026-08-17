import { ethers } from "hardhat";

async function main() {
  console.log("----------------------------------------------------");
  console.log("Deploying ADEXTO Smart Contracts...");
  console.log("----------------------------------------------------");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer Address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH / A0GI`);

  // 1. Deploy Trinity Factory
  const Factory = await ethers.getContractFactory("AdextoTrinityFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`✅ AdextoTrinityFactory deployed to: ${factoryAddress}`);

  // 2. Deploy sample ERC-8004 Token via Factory
  const signerAddress = process.env.SIGNER_ADDRESS || deployer.address;
  const sampleTx = await factory.deployTrinityProject(
    "Aegis Autonomous Token",
    "ADAI",
    ethers.parseEther("1000000000"), // 1B supply
    signerAddress,
    30, // 0.30% fee
    10, // 0.10% treasury cut
    ethers.keccak256(ethers.toUtf8Bytes("0G_TEE_VALIDATED_ROOT"))
  );
  const receipt = await sampleTx.wait();
  console.log(`✅ Sample Project Initialized. Tx: ${receipt?.hash}`);

  console.log("----------------------------------------------------");
  console.log("Deployment Complete!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
