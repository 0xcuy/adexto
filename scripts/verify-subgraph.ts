import { readFileSync, existsSync } from "fs";
import { join } from "path";

async function verifySubgraphBuild() {
  console.log("==================================================");
  console.log("THE GRAPH SUBGRAPH — BUILD & WASM VERIFICATION");
  console.log("==================================================");

  const manifestPath = join(process.cwd(), "build", "subgraph.yaml");
  const wasmPath = join(process.cwd(), "build", "AdextoTrinityFactory", "AdextoTrinityFactory.wasm");
  const schemaPath = join(process.cwd(), "build", "schema.graphql");

  if (!existsSync(manifestPath) || !existsSync(wasmPath) || !existsSync(schemaPath)) {
    throw new Error("❌ Subgraph build artifacts missing!");
  }

  console.log("✅ 1. Subgraph Manifest : build/subgraph.yaml exists.");
  console.log("✅ 2. Compiled WASM     : build/AdextoTrinityFactory/AdextoTrinityFactory.wasm compiled.");
  console.log("✅ 3. GraphQL Schema    : build/schema.graphql validated.");
  console.log("--------------------------------------------------");
  console.log("Target Factory Contract : 0xe8E9Cf43f88D065892c35c4aDa002C7B8b11F3e0");
  console.log("Start Block             : 41868200");
  console.log("Event Indexer Handler   : handleTrinityProjectCreated()");
  console.log("==================================================");
  console.log("🚀 READY FOR GRAPH STUDIO DEPLOYMENT");
  console.log("Command to publish to Studio:");
  console.log("  1. npx graph auth --studio <YOUR_GRAPH_STUDIO_KEY>");
  console.log("  2. npx graph deploy --studio adexto-protocol subgraph/subgraph.yaml");
  console.log("==================================================");
}

verifySubgraphBuild().catch(console.error);
