import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { TrinityProjectCreated } from "../generated/AdextoTrinityFactory/AdextoTrinityFactory";
import { Project, GlobalStats } from "../generated/schema";

export function handleTrinityProjectCreated(event: TrinityProjectCreated): void {
  let project = new Project(event.params.token.toHexString());
  project.tokenAddress = event.params.token;
  project.creator = event.params.creator;
  project.symbol = event.params.symbol;
  project.name = event.params.symbol; // Default to symbol or factory state
  project.swapFeeBps = BigInt.fromI32(30);
  project.treasuryShareBps = BigInt.fromI32(10);
  project.teeAttestationRoot = event.params.teeAttestationRoot;
  project.deployedAt = event.block.timestamp;
  project.blockNumber = event.block.number;
  project.blockTimestamp = event.block.timestamp;
  project.transactionHash = event.transaction.hash;
  project.save();

  let stats = GlobalStats.load("global");
  if (stats == null) {
    stats = new GlobalStats("global");
    stats.totalProjects = BigInt.fromI32(0);
    stats.totalVolumeUSD = BigInt.fromI32(0).toBigDecimal();
    stats.totalFeesGeneratedUSD = BigInt.fromI32(0).toBigDecimal();
    stats.totalBuybacksUSD = BigInt.fromI32(0).toBigDecimal();
  }
  stats.totalProjects = stats.totalProjects.plus(BigInt.fromI32(1));
  stats.save();
}
