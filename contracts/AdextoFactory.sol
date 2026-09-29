// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AdextoToken} from "./AdextoToken.sol";
import {AdextoCurve} from "./AdextoCurve.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/**
 * @title AdextoFactory
 * @notice Zero-deposit launch for ADEXTO (adexto.xyz): token + bonding curve in one
 *         transaction, no liquidity deposit, and a protocol fee leg that the protocol
 *         itself can actually collect.
 *
 * @dev NAMANYA TIDAK MEMUAT NOMOR GENERASI
 *
 * Berkas ini sempat bernama `AdextoCurveFactoryV2`. Suffix itu dibuang sebelum
 * di-broadcast, dengan alasan yang sama yang sudah ditulis panjang di
 * `AdextoCurveFactory`: nama kontrak permanen begitu diverifikasi, jadi angka generasi
 * di dalam nama memaksa setiap perbaikan berikutnya mengarang angka lagi — V3, V4 —
 * dan konsumen harus mengejar nama, bukan alamat.
 *
 * Argumen itu sempat saya anggap gugur karena dua factory kini hidup bersamaan dan dua
 * kontrak tidak bisa berbagi satu nama. Yang benar adalah: keduanya memang butuh nama
 * BERBEDA, tapi tidak harus nama BERNOMOR. Proyek yang baru mulai tetapi sudah memajang
 * "V2" terbaca seperti sudah dua kali dibongkar, padahal yang terjadi hanya satu
 * penambahan pada kaki fee.
 *
 * `VERSION` di bawah tetap memuat angka presisnya, dan di situ ia bisa naik tanpa
 * mengubah identitas kontrak.
 *
 * WHAT CHANGED FROM AdextoCurveFactory
 *
 * One addition: `PROTOCOL_FEE_BPS`, charged on top of the creator's configured
 * total and claimable only to the `immutable protocolTreasury` set at deployment.
 *
 * Everything a reader or indexer depends on is unchanged. `deployTrinity` keeps its
 * exact signature and therefore its selector; `TrinityProjectDeployed`,
 * `TrinityProjectCreated` and `AgentBound` keep their exact signatures and
 * therefore their `topic0`; `projectAt` keeps its return shape. A client can read
 * both factories through one code path, which is the only reason two live factories
 * are maintainable at all.
 *
 * There is deliberately NO per-launch event announcing the protocol fee. It is a
 * constant on this contract, identical for every market it deploys, so an event
 * would repeat a value that is already readable without a launch having happened.
 *
 * SIFAT EKONOMI YANG DIPERTAHANKAN DARI GENERASI SEBELUMNYA
 *
 *   - tanpa setoran native: kurva membuka terhadap reserve virtual;
 *   - 100% supply masuk kurva, jadi creator tidak memegang apa pun untuk dijual;
 *   - creator dibayar dari irisan fee setiap swap, ke alamat yang terkunci di
 *     kurva sejak deployment.
 */
contract AdextoFactory {
    /**
     * @notice Versi factory, dibaca on-chain.
     * @dev `0.y.z` berarti pengembangan awal: API publiknya belum boleh dianggap
     *      stabil. Naik ke 1.0.0 hanya setelah factory ini ter-broadcast ke mainnet
     *      dan satu peluncuran nyata berhasil.
     */
    /**
     * 0.12.0 KARENA PERILAKUNYA BERUBAH, dan nomor ini tidak boleh berbohong.
     *
     * `executeBuyback` mendapat cooldown (lihat catatan panjang pada fungsinya, temuan 1 di
     * GHSA-g589-wjqq-86f2). Bytecode-nya ikut berubah — terukur: artifact 21.476 B lawan
     * 21.281 B di chain — jadi membiarkan nomornya tetap 0.11.0 berarti dua bytecode berbeda
     * mengaku sebagai generasi yang sama, dan tidak akan ada cara membedakannya dari luar.
     *
     * `src/config/contracts.ts` SENGAJA tetap 0.11.0: berkas itu mencatat generasi yang
     * benar-benar HIDUP di keempat chain, dan `audit_consistency.mjs` membacanya lalu
     * membandingkannya dengan `VERSION()` on-chain. Ia baru naik ketika 0.12.0 di-deploy.
     */
    string public constant VERSION = "0.12.0";

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000; // 1e12 whole tokens
    /// @dev Anti-sniper window: 1% max transaction for the first blocks.
    uint256 public constant ANTI_SNIPER_BPS = 100;

    /**
     * @notice Protocol fee charged on every swap, in basis points. 10 bps = 0.10%.
     *
     * @dev A CONSTANT, AND CARVED OUT OF `swapFeeBps` RATHER THAN ADDITIVE TO IT.
     *      THIS REVERSED IN 0.12.0 — read on, because the old behaviour is what the
     *      deployed 0.11.0 markets still do and they will do it forever.
     *
     * `swapFeeBps` is now the WHOLE fee a trader pays. The 0.12.0 launch model is
     * 100 bps split four ways:
     *
     *   creator  70 bps    streamed to the creator
     *   depth    10 bps    stays in the curve, raising the floor
     *   buyback  10 bps    buys and burns, never leaves the curve
     *   protocol 10 bps    claimable only to `protocolTreasury`
     *   -----------------
     *   total   100 bps    = 1.00%, which is what the trader is quoted
     *
     * In 0.11.0 this constant was ADDITIVE: a market configured as 0.30% charged
     * 0.40%. That was the right call at the time and for a reason worth keeping on
     * record — carving the protocol leg out of an already-published 0.30% would
     * have reallocated money that depth and the creator had already been promised,
     * where charging 10 bps more was at least visible at the point of trade.
     *
     * What changed is not the reasoning, it is the number the fee is carved from.
     * At a 100 bps total there is room for a 10 bps protocol leg without taking
     * anything from the two legs that carry the product's guarantees: depth still
     * gets its own 10 bps so the floor still rises, and the creator's share goes UP
     * from 10 bps to 70 bps rather than down. Nobody is quietly paid less; the
     * trader is quoted one number and that number is the truth.
     *
     * The consequence to state plainly: a market deployed by a 0.11.0 factory pays
     * its own rates permanently, because every leg is `immutable` and there is no
     * proxy. This change reaches new markets only.
     *
     * A constant, not a parameter, so every market this factory deploys charges the
     * same and the figure is readable here before anyone trades. It cannot be
     * changed for a deployed factory; a different rate means a different factory at
     * a different address, which is a visible event rather than a silent one.
     */
    uint256 public constant PROTOCOL_FEE_BPS = 10;

    /**
     * @notice Where protocol fees from every market this factory deploys are sent.
     *
     * @dev Immutable, and passed to each curve as that curve's own immutable
     *      `protocolTreasury`. There is no setter here and none in the curve, so
     *      revenue from a launched market can never be redirected — including by
     *      us. A setter would make both contracts owned, which contradicts the
     *      claim on /security that nobody can change the terms of a launched
     *      market, and that claim is the product rather than a detail of it.
     *
     *      A constructor parameter rather than a hardcoded constant because the
     *      address differs per chain, and editing source per chain would mean four
     *      slightly different sources to verify against four deployments.
     */
    address public immutable protocolTreasury;

    /**
     * @notice ERC-8004 Identity Registry, used to check agent ownership at launch.
     * @dev Same deterministic `0x8004`-prefixed singleton on every chain we launch
     *      on: 0G (16661), Base (8453), Arbitrum One (42161), Monad (143). Only a
     *      `view` function is ever called through it, so a hostile or broken upgrade
     *      of that proxy can make an agent-bound launch revert but can never alter
     *      what a launch does.
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
        uint256 protocolFeeBps;
        /// @dev Root penyimpanan 0G DA dari metadata launch. Bukan attestation.
        bytes32 metadataRoot;
        uint256 deployedAt;
    }

    ProjectDeployment[] public allProjects;
    mapping(address => address) public curveOf;
    mapping(address => address) public tokenOf;
    mapping(bytes32 => address) public symbolRegistry;

    /**
     * @notice Penanda untuk ticker yang dicadangkan di constructor, bukan oleh peluncuran.
     *
     * @dev `symbolRegistry` memetakan ticker ke ALAMAT TOKEN, dan ticker yang dicadangkan
     *      belum punya token. Nilai ini menempati slotnya supaya
     *      `require(symbolRegistry[key] == address(0))` di `deployTrinity` menolaknya
     *      lewat jalur yang sudah ada — tanpa fungsi baru, tanpa daftar kedua, tanpa
     *      owner.
     *
     *      Dibuat KONSTANTA BERNAMA dan bukan `address(1)` telanjang supaya pembaca
     *      `symbolRegistry` bisa membedakan "dicadangkan" dari "token rusak". Aman
     *      dipakai karena tidak ada apa pun di luar Solidity yang membaca mapping ini:
     *      aplikasi hanya memanggil `isSymbolAvailable` dan `curveOf`, dan keduanya
     *      berperilaku benar — `isSymbolAvailable` mengembalikan false, `curveOf`
     *      tidak pernah dikunci oleh ticker.
     *
     *      Alamat ini tidak bisa jadi token sungguhan: ia tidak punya kode, dan
     *      `deployTrinity` hanya pernah menulis alamat hasil `new AdextoToken`.
     */
    address public constant SYMBOL_RESERVED = address(1);
    mapping(address => address[]) public userDeployments;
    mapping(address => uint256) public agentIdOf;

    event TrinityProjectCreated(
        address indexed token,
        address indexed creator,
        string symbol,
        bytes32 metadataRoot
    );
    /**
     * @dev Signature identical to v0.10.0, therefore same `topic0`. The protocol
     *      fee is deliberately absent: it is a constant on this factory and an
     *      immutable on each curve, so adding it here would change the signature
     *      and silently stop every existing subgraph mapping from matching, in
     *      exchange for repeating a value that is already readable.
     */
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
     * @notice Satu ticker yang dicadangkan saat factory dibuat.
     *
     * @dev Ada supaya daftar cadangan bisa dibaca dari log tanpa memindai `symbolRegistry`
     *      kunci demi kunci — mapping tidak bisa dienumerasi, dan `isSymbolAvailable`
     *      menuntut penanya sudah tahu nama yang mau diperiksa. Tanpa event ini,
     *      satu-satunya cara mengetahui apa saja yang dicadangkan adalah membaca calldata
     *      transaksi deployment, yang tidak dilayani setiap explorer.
     */
    event SymbolReserved(string symbol);
    event AgentBound(
        address indexed token,
        uint256 indexed agentId,
        address indexed agentRegistry,
        address owner
    );

    /**
     * @param _protocolTreasury Tujuan permanen fee protokol dari setiap pasar factory ini.
     * @param reservedSymbols Ticker yang dicadangkan saat kelahiran, tidak akan pernah bisa
     *        diluncurkan di factory ini oleh siapa pun.
     *
     * @dev KENAPA PENCADANGAN HARUS TERJADI DI SINI, BUKAN LEWAT FUNGSI
     *
     * `symbolRegistry` adalah state MILIK SATU FACTORY, bukan daftar global. Jadi factory
     * baru lahir dengan buku ticker kosong, dan setiap nama yang sudah dipakai generasi
     * sebelumnya bebas diklaim lagi di sini — termasuk nama pasar yang sedang hidup dan
     * nama aset besar. Terukur sebelum perubahan ini, lewat `isSymbolAvailable` pada
     * keempat factory 0.11.0 yang live: "ETH", "USDC" dan "BTC" bebas di keempat chain,
     * dan "ADEXTO" bebas di Base, Arbitrum dan Monad.
     *
     * Daftar reserved off-chain di `src/lib/registry.ts` tidak menutup itu, dan tidak bisa:
     * `deployTrinity` tidak punya access control sama sekali, jadi siapa pun boleh
     * memanggil factory langsung tanpa melewati situs. Yang dihalangi daftar off-chain
     * hanyalah PENDAFTARAN di situs — pasarnya tetap lahir di chain.
     *
     * Constructor adalah satu-satunya tempat yang benar. Sebuah fungsi `reserve()` akan
     * menuntut alamat yang berwenang memanggilnya, dan kunci itu bisa hilang atau
     * dipakai untuk mencadangkan nama orang lain setelah factory hidup. Di sini
     * daftarnya ditetapkan sekali, terbaca di calldata deployment selamanya, dan tidak
     * ada yang bisa menambah maupun mengurangi sesudahnya.
     *
     * TETAP TIDAK ADA FUNGSI UNTUK MELEPAS. Ticker yang dicadangkan atau diklaim di sini
     * permanen. Jadi satu salah ketik di daftar ini mengunci nama itu selamanya di
     * factory ini — periksa daftarnya sebelum broadcast, bukan sesudahnya.
     *
     * Duplikat DIIZINKAN dan tidak berbahaya: penulisan kedua menimpa slot dengan nilai
     * yang sama. Menolaknya akan menambah biaya dan risiko revert saat deployment demi
     * masalah yang tidak ada akibatnya.
     */
    constructor(address _protocolTreasury, string[] memory reservedSymbols) {
        require(_protocolTreasury != address(0), "Factory: zero protocol treasury");
        protocolTreasury = _protocolTreasury;

        for (uint256 i = 0; i < reservedSymbols.length; i++) {
            // `_toUpper` dipakai di sini DAN di `deployTrinity`, jadi "eth" dan "ETH"
            // menghasilkan kunci yang sama. Tanpa itu, mencadangkan "ETH" tidak akan
            // menghalangi peluncuran "eth" — nama yang sama bagi setiap pembaca manusia.
            symbolRegistry[keccak256(abi.encodePacked(_toUpper(reservedSymbols[i])))] = SYMBOL_RESERVED;
            emit SymbolReserved(reservedSymbols[i]);
        }
    }

    /**
     * @notice Deploy a token and its bonding curve in one transaction.
     * @param swapFeeBps The WHOLE fee a trader pays, split four ways: the two share
     *        parameters, the `PROTOCOL_FEE_BPS` constant, and depth as the remainder.
     *        Nothing is charged on top of this. Changed in 0.12.0 — in 0.11.0 the
     *        protocol leg was additive, so the real total was `swapFeeBps + 10`.
     * @param creatorShareBps Portion of `swapFeeBps` streamed to the creator.
     * @param treasuryShareBps Portion of `swapFeeBps` routed to the agent vault.
     * @param metadataRoot 0G DA storage root of the launch metadata.
     * @param bindAgent Whether to attach an ERC-8004 agent identity at all.
     * @param agentId ERC-8004 agent id to bind. Required to be 0 when `bindAgent`
     *        is false, rather than silently ignored, because handing back a token
     *        whose agent the creator believes is attached cannot be fixed later.
     *
     * @dev Signature identical to v0.10.0, therefore same selector. Deliberately
     *      NOT payable: requiring native here is the barrier this generation exists
     *      to remove.
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
        // The 5% cap applies to what a trader actually pays, and since 0.12.0 that is
        // `swapFeeBps` on its own — the protocol leg is carved out of it, not added to
        // it, so adding `PROTOCOL_FEE_BPS` here again would cap the real total at 4.9%
        // while claiming 5%.
        require(swapFeeBps <= 500, "Factory: fee too high");
        /**
         * The protocol leg is INSIDE this comparison, and that is the check that makes
         * the carve-out real rather than nominal.
         *
         * Without `PROTOCOL_FEE_BPS` on the left, a launch could set
         * `creatorShareBps + treasuryShareBps == swapFeeBps` and leave nothing for the
         * protocol leg — and the subtraction computing `depthFeeBps` below would then
         * underflow and revert, which in 0.8.x is a panic with no message. The failure
         * would be correct but unreadable: a creator would see an unexplained revert
         * for a fee split that looks arithmetically fine to them.
         *
         * It also enforces the floor: `swapFeeBps` can never be less than
         * `PROTOCOL_FEE_BPS`, because the two shares cannot be negative.
         */
        require(
            creatorShareBps + treasuryShareBps + PROTOCOL_FEE_BPS <= swapFeeBps,
            "Factory: shares exceed fee"
        );

        bytes32 symbolKey = keccak256(abi.encodePacked(_toUpper(symbol)));
        require(symbolRegistry[symbolKey] == address(0), "Factory: symbol already taken");

        // Bind an agent only to the address that owns it. Without this check any
        // launch could attach itself to somebody else's registered agent and
        // inherit its reputation. `try` is used because the registry is external
        // and upgradeable: a revert there must produce this contract's own message.
        address agentRegistry = address(0);
        if (bindAgent) {
            try IIdentityRegistry(AGENT_REGISTRY).ownerOf(agentId) returns (address agentOwner) {
                require(agentOwner == msg.sender, "Factory: agent not owned by caller");
            } catch {
                revert("Factory: agent id not registered");
            }
            agentRegistry = AGENT_REGISTRY;
        } else {
            require(agentId == 0, "Factory: agentId set without bindAgent");
        }

        // Depth is the REMAINDER after the three named legs, so the four always sum to
        // exactly `swapFeeBps` and the trader's quote cannot drift from the split. The
        // `PROTOCOL_FEE_BPS` term is what changed in 0.12.0; the require above
        // guarantees this cannot underflow.
        uint256 depthFeeBps = swapFeeBps - creatorShareBps - treasuryShareBps - PROTOCOL_FEE_BPS;

        // 1. Deploy the curve first so the token can bind to it immutably.
        AdextoCurve sovereignCurve = new AdextoCurve(
            address(this),
            agentIdentity,
            msg.sender,
            protocolTreasury,
            virtualNative,
            depthFeeBps,
            creatorShareBps,
            treasuryShareBps,
            PROTOCOL_FEE_BPS
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
        /**
         * REGISTRY DITULIS DI SINI, bukan setelah kurva diisi.
         *
         * `curve` dan `token` sudah final pada titik ini, jadi menunda penulisannya sampai
         * setelah `bindToken` dan `initializeCurve` tidak memberi apa pun — sementara itu
         * membuat setiap tulisan terjadi SESUDAH panggilan eksternal, yang dilaporkan Aderyn
         * sebagai High "Reentrancy: State change after external call", 6 instance di berkas ini.
         *
         * Dipindah ke depan, urutannya menjadi checks-effects-interactions. Dan ini lebih ketat
         * daripada sekadar rapi: pada urutan lama `symbolRegistry[symbolKey]` masih nol selama
         * kontrak lain dipanggil, jadi panggilan yang masuk kembali bisa mengklaim ticker yang
         * sama. Sekarang klaim kedua menabrak `require` yang sudah ada di atas.
         */
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
                protocolFeeBps: PROTOCOL_FEE_BPS,
                metadataRoot: metadataRoot,
                deployedAt: block.timestamp
            })
        );
        userDeployments[msg.sender].push(token);
        if (bindAgent) {
            agentIdOf[token] = agentId;
            emit AgentBound(token, agentId, agentRegistry, msg.sender);
        }


        // 3. Bind and load the curve atomically with 100% of supply. No native
        //    changes hands, so a launch costs the creator gas only.
        sovereignCurve.bindToken(token);
        uint256 minted = IERC20SupplySeed(token).balanceOf(address(this));
        require(minted > 0, "Factory: nothing minted");
        require(IERC20SupplySeed(token).approve(curve, minted), "Factory: approve failed");
        sovereignCurve.initializeCurve(minted);

        // 4. Nothing is forwarded to the creator on purpose: no free allocation
        //    means no supply to dump. The creator earns from `creatorShareBps`.
        require(IERC20SupplySeed(token).balanceOf(address(this)) == 0, "Factory: supply not fully seeded");


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

    /// @dev Return shape identical to v0.10.0 so one client path reads both factories.
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

/**
 * @dev Permukaan ERC-20 sekecil yang dibutuhkan factory untuk memuat kurva: setujui,
 *      lalu pastikan saldonya sendiri nol.
 *
 *      Dinamai sendiri, bukan `IERC20Approve` seperti di `AdextoCurveFactory.sol`,
 *      karena nama yang sama di dua berkas membuat pencarian artifact berdasarkan nama
 *      jadi ambigu — hal yang sama yang ditandai Aderyn pada interface di
 *      `AdextoCurve.sol`.
 */
interface IERC20SupplySeed {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
