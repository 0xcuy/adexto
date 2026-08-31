// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoToken} from "./AdextoToken.sol";
import {SovereignCurve} from "./SovereignCurve.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AdextoCurveFactory
 * @notice Zero-deposit launch for ADEXTO (adexto.xyz): token + bonding curve in
 *         one transaction, no liquidity deposit.
 *
 * @dev KENAPA NAMANYA BUKAN LAGI `AdextoTrinityFactoryV3`
 *
 * Berkas ini sebelumnya bernama itu, dan angka 3-nya jujur secara internal: v1
 * tidak punya pool sama sekali, v2 mewajibkan seed native yang terkunci selamanya,
 * v3 memakai kurva bervirtual-reserve. Tiga generasi itu memang ada.
 *
 * Masalahnya, generasi adalah artefak pengembangan KAMI, bukan informasi yang
 * berguna bagi siapa pun yang memakai kontrak ini. Dan nama kontrak bersifat
 * PERMANEN begitu diverifikasi di explorer: ia tertanam di source terverifikasi
 * dan di setiap ABI yang orang integrasikan. Menyematkan "V3" berarti setiap
 * perbaikan berikutnya memaksa nama baru lagi — V4, V5 — dan konsumen harus
 * mengejar nama, bukan alamat.
 *
 * Karena factory ini BELUM di-broadcast ke mainnet (baru 4 testnet + devchain),
 * inilah kesempatan terakhir memperbaikinya secara gratis. Namanya sekarang
 * menyebut apa yang ia lakukan; nomor versinya pindah ke `VERSION` di bawah,
 * tempat ia bisa berubah tanpa mengubah identitas kontrak.
 *
 * `SovereignCurve` sejak awal tidak pernah membawa suffix versi, jadi hanya
 * factory ini yang menyimpang.
 *
 * KENAPA `deployTrinity` DAN NAMA EVENT TETAP
 *
 * Mengubah nama fungsi mengubah selector-nya, dan mengubah nama event mengubah
 * apa yang harus dicocokkan pembaca. Keduanya bukan perbaikan kejujuran — hanya
 * kosmetik dengan biaya nyata pada ABI, harness, dan indexer. Nama fungsi dan
 * event dibiarkan.
 *
 * `metadataRoot` ADALAH PERBAIKAN NAMA YANG NYATA
 *
 * Parameter ini dulu bernama `teeAttestationRoot`, dan itu keliru: nilainya adalah
 * root penyimpanan 0G DA dari metadata launch — sebuah hash konten — bukan laporan
 * attestation hardware. Nama lamanya membuat halaman produk mengklaim attestation
 * yang tidak pernah diperiksa siapa pun.
 *
 * Nama PARAMETER tidak masuk hitungan selector fungsi maupun `topic0` event —
 * keduanya diturunkan dari TIPE saja. Jadi penggantian nama ini tidak memutus
 * kompatibilitas ABI: calldata dan filter log yang sudah ada tetap cocok.
 *
 * SIFAT EKONOMI YANG DIPERTAHANKAN DARI GENERASI SEBELUMNYA
 *
 *   - tanpa setoran native: kurva membuka terhadap reserve virtual;
 *   - 100% supply masuk kurva, jadi creator tidak memegang apa pun untuk dijual;
 *   - creator dibayar dari irisan fee setiap swap, ke alamat yang terkunci di
 *     kurva sejak deployment.
 *
 * `virtualNative` dikirim per launch karena ia menetapkan harga pembukaan, dan
 * karena seluruh supply ada di kurva, ia SAMA DENGAN market cap pembukaan dalam
 * aset native chain itu.
 */
contract AdextoCurveFactory {
    /**
     * @notice Versi factory, dibaca on-chain.
     * @dev Di sinilah nomor versi tinggal, bukan di nama kontrak. `0.y.z` berarti
     *      pengembangan awal: API publiknya belum boleh dianggap stabil. Naik ke
     *      1.0.0 hanya setelah factory ini benar-benar ter-broadcast ke mainnet
     *      dan satu peluncuran nyata berhasil — supaya angkanya berarti sesuatu.
     */
    string public constant VERSION = "0.10.0";

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000; // 1e12 whole tokens
    /// @dev Anti-sniper window: 1% max transaction for the first blocks.
    uint256 public constant ANTI_SNIPER_BPS = 100;

    /**
     * @notice ERC-8004 Identity Registry, used to check agent ownership at launch.
     *
     * @dev A CONSTANT, BECAUSE IT IS THE SAME ADDRESS ON EVERY CHAIN WE LAUNCH ON
     *
     * ERC-8004 deploys its registries as per-chain singletons at a deterministic
     * address with an `0x8004` vanity prefix. Confirmed present and answering
     * `ownerOf` at this exact address on all four target mainnets — 0G (16661),
     * Base (8453), Arbitrum One (42161) and Monad (143) — so a constructor
     * parameter would add a way to misconfigure a deployment without adding any
     * capability. Read back from the deployed factory as `AGENT_REGISTRY` if you
     * want to check rather than trust this comment.
     *
     * The registry is an upgradeable proxy owned by a third party. Only a `view`
     * function is ever called through it, so a hostile or broken upgrade can make
     * an agent-bound launch revert but can never alter what a launch does.
     */
    address public constant AGENT_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    struct ProjectDeployment {
        address token;
        address curve;
        address creator;
        string name;
        string symbol;
        uint256 virtualNative;
        uint256 depthFeeBps;
        uint256 creatorFeeBps;
        uint256 treasuryBuybackBps;
        /// @dev Root penyimpanan 0G DA dari metadata launch. Bukan attestation.
        bytes32 metadataRoot;
        uint256 deployedAt;
    }

    ProjectDeployment[] public allProjects;
    mapping(address => address) public curveOf;
    mapping(address => address) public tokenOf;
    mapping(bytes32 => address) public symbolRegistry;
    mapping(address => address[]) public userDeployments;

    /**
     * @notice ERC-8004 agent id bound to a launched token, 0 when unbound.
     * @dev A separate mapping rather than a new field on `ProjectDeployment`, so
     *      the `allProjects` and `projectAt` return shapes stay exactly as they
     *      were and existing readers keep working.
     */
    mapping(address => uint256) public agentIdOf;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 metadataRoot
    );
    event TrinityProjectDeployed(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        uint256 curveTokens,
        uint256 virtualNative,
        uint256 depthFeeBps,
        uint256 creatorFeeBps,
        uint256 treasuryBuybackBps,
        bytes32 metadataRoot
    );

    /**
     * @notice Emitted only when a launch binds an ERC-8004 agent identity.
     * @dev Deliberately a separate event instead of a field added to
     *      `TrinityProjectDeployed`: adding a parameter changes an event's
     *      signature and therefore its `topic0`, which would silently stop every
     *      existing subgraph mapping and log filter from matching. This is
     *      additive, so readers that do not care are unaffected.
     * @param agentRegistry Recorded because an agentId only identifies an agent
     *        together with its registry, per ERC-8004's
     *        `{namespace}:{chainId}:{identityRegistry}` form.
     */
    event AgentBound(
        address indexed token,
        uint256 indexed agentId,
        address indexed agentRegistry,
        address owner
    );

    /**
     * @notice Deploy a token and its bonding curve in one transaction.
     * @param virtualNative Virtual native reserve; equals the opening market cap
     *        in native terms because all supply enters the curve.
     * @param swapFeeBps Total fee, split three ways by the two share parameters.
     * @param creatorShareBps Portion of `swapFeeBps` streamed to the creator.
     * @param treasuryShareBps Portion of `swapFeeBps` routed to the agent vault.
     * @param metadataRoot 0G DA storage root of the launch metadata.
     * @param bindAgent Whether to attach an ERC-8004 agent identity at all.
     * @param agentId ERC-8004 agent id to bind. Ignored, and required to be 0, when
     *        `bindAgent` is false.
     *
     * WHY `bindAgent` IS A SEPARATE FLAG AND NOT `agentId == 0`
     *
     * The obvious encoding is to let id 0 mean "no agent". A live check killed it:
     * `ownerOf(0)` returns a real owner on 0G, Base, Arbitrum One and Monad
     * mainnet, so agent 0 is an ordinary agent that somebody already owns on every
     * chain we launch on. Overloading 0 would have permanently barred its owner from
     * binding it and made a real binding indistinguishable from none — in bytecode
     * that cannot be changed afterwards.
     *
     * @dev Deliberately NOT payable. Requiring native here is precisely the
     *      barrier this generation exists to remove.
     *
     * WHY `agentId` IS A PARAMETER AND NOT A REGISTRATION PERFORMED HERE
     *
     * The obvious design is for this function to call `register()` itself and hand
     * the resulting agent to the creator, keeping everything in one transaction.
     * Three findings ruled that out.
     *
     * First, ERC-8004's registration file is supposed to carry its own
     * `registrations[].agentId`, and the id does not exist until `register()`
     * returns. A file pinned to IPFS before this transaction therefore cannot
     * contain it, and IPFS addresses are content hashes, so it cannot be patched
     * afterwards without a new CID and a further transaction. Registering first
     * makes the file correct the first time.
     *
     * Second, the registry is an upgradeable proxy controlled by a third party.
     * Calling a state-changing function on it from inside an immutable launch path
     * would let somebody else change what a launch does, after the fact. A single
     * `view` call cannot.
     *
     * Third, ERC-8004 sets the reserved `agentWallet` metadata to the owner at
     * registration and CLEARS it on transfer. A factory that minted and then
     * forwarded the agent would hand every creator an agent whose wallet had been
     * wiped and needed a fresh EIP-712 proof.
     *
     * So the creator registers against the registry directly and passes the id
     * here. `agentId == 0` keeps the plain one-transaction launch available, which
     * is why the "gas only, one transaction" property survives this change.
     */
    function deployTrinity(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address agentIdentity,
        uint256 virtualNative,
        uint256 swapFeeBps,
        uint256 creatorShareBps,
        uint256 treasuryShareBps,
        bytes32 metadataRoot,
        bool bindAgent,
        uint256 agentId
    ) external returns (address token, address curve) {
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 12, "Factory: bad symbol");
        require(bytes(name).length > 0 && bytes(name).length <= 64, "Factory: bad name");
        require(initialSupply > 0 && initialSupply <= MAX_SUPPLY, "Factory: bad supply");
        require(agentIdentity != address(0), "Factory: zero agent");
        require(virtualNative > 0, "Factory: zero virtual reserve");
        require(swapFeeBps <= 500, "Factory: fee too high");
        require(creatorShareBps + treasuryShareBps <= swapFeeBps, "Factory: shares exceed fee");

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        // Bind an agent only to the address that owns it. Without this check any
        // launch could attach itself to somebody else's registered agent and
        // inherit its reputation — the precise impersonation ERC-8004's identity
        // layer exists to prevent. `try` is used because the registry is external
        // and upgradeable: a revert there must produce this contract's own message
        // rather than an opaque bubbled-up failure.
        address agentRegistry = address(0);
        if (bindAgent) {
            try IIdentityRegistry(AGENT_REGISTRY).ownerOf(agentId) returns (address agentOwner) {
                require(agentOwner == msg.sender, "Factory: agent not owned by caller");
            } catch {
                revert("Factory: agent id not registered");
            }
            agentRegistry = AGENT_REGISTRY;
        } else {
            // Refuse a non-zero id that will not be bound, rather than ignoring it.
            // Silently dropping it would hand back a token whose agent the creator
            // believes is attached, and the mistake is unfixable afterwards.
            require(agentId == 0, "Factory: agentId set without bindAgent");
        }

        uint256 depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps;

        // 1. Deploy the curve first so the token can bind to it immutably.
        SovereignCurve sovereignCurve = new SovereignCurve(
            address(this),
            agentIdentity,
            msg.sender,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps
        );
        curve = address(sovereignCurve);

        // 2. Deploy the token; the whole supply is minted to this factory.
        AdextoToken newToken = new AdextoToken(
            name,
            symbol,
            initialSupply,
            agentIdentity,
            curve,
            ANTI_SNIPER_BPS,
            bindAgent,
            agentId,
            agentRegistry
        );
        token = address(newToken);

        // 3. Bind and load the curve atomically with 100% of supply. No native
        //    changes hands, so a launch costs the creator gas only.
        sovereignCurve.bindToken(token);
        uint256 minted = IERC20Approve(token).balanceOf(address(this));
        require(minted > 0, "Factory: nothing minted");
        require(IERC20Approve(token).approve(curve, minted), "Factory: approve failed");
        sovereignCurve.initializeCurve(minted);

        // 4. Nothing is forwarded to the creator on purpose: no free allocation
        //    means no supply to dump. The creator earns from `creatorShareBps`.
        require(IERC20Approve(token).balanceOf(address(this)) == 0, "Factory: supply not fully seeded");

        symbolRegistry[symbolKey] = token;
        curveOf[token] = curve;
        tokenOf[curve] = token;
        allProjects.push(
            ProjectDeployment({
                token: token,
                curve: curve,
                creator: msg.sender,
                name: name,
                symbol: symbol,
                virtualNative: virtualNative,
                depthFeeBps: depthFeeBps,
                creatorFeeBps: creatorShareBps,
                treasuryBuybackBps: treasuryShareBps,
                metadataRoot: metadataRoot,
                deployedAt: block.timestamp
            })
        );
        userDeployments[msg.sender].push(token);
        if (bindAgent) {
            // `agentIdOf` alone cannot express "bound to agent 0", so the event is
            // the authoritative record of a binding. Readers wanting a cheap
            // storage check should use `AdextoToken.agentBound()`.
            agentIdOf[token] = agentId;
            emit AgentBound(token, agentId, agentRegistry, msg.sender);
        }

        emit TrinityProjectCreated(token, msg.sender, symbol, metadataRoot);
        emit TrinityProjectDeployed(
            token,
            curve,
            msg.sender,
            name,
            symbol,
            initialSupply,
            minted,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps,
            metadataRoot
        );
    }

    function totalProjectsCount() external view returns (uint256) {
        return allProjects.length;
    }

    function projectAt(uint256 index)
        external
        view
        returns (address token, address curve, address creator, string memory symbol, uint256 deployedAt)
    {
        ProjectDeployment storage p = allProjects[index];
        return (p.token, p.curve, p.creator, p.symbol, p.deployedAt);
    }

    function isSymbolAvailable(string memory symbol) external view returns (bool) {
        return symbolRegistry[keccak256(abi.encodePacked(_toUpper(symbol)))] == address(0);
    }

    function _toUpper(string memory input) private pure returns (string memory) {
        bytes memory b = bytes(input);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7A) {
                b[i] = bytes1(uint8(b[i]) - 32);
            }
        }
        return string(b);
    }
}
