// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * Token EIP-3009 minimal, HANYA untuk pengujian facilitator x402.
 *
 * Ditulis karena upaya menguji langsung terhadap USDC Base di atas fork anvil ditolak
 * dengan "FiatTokenV2: invalid signature" untuk setiap kombinasi domain yang dicoba —
 * enam belas kombinasi nama/versi/chainId, dan `permit` pun sama-sama ditolak meskipun
 * `DOMAIN_SEPARATOR()` yang dikembalikan kontrak COCOK dengan hasil hitungan kita dan
 * precompile `ecrecover` di fork itu terbukti sehat. Sebabnya tidak berhasil saya
 * isolasi, jadi saya tidak mengklaim tahu.
 *
 * Yang bisa dibuktikan tanpa misteri itu: bahwa facilitator kita membentuk otorisasi yang
 * DITERIMA oleh implementasi EIP-3009 yang patuh. Token ini implementasi seperti itu,
 * ditulis mengikuti spesifikasi — typehash, urutan waktu, nonce sekali-pakai — sehingga
 * yang menghakimi tetap aturan standar, bukan asumsi kita.
 *
 * BUKAN untuk di-deploy ke mainnet. Tidak ada kontrol akses pada `mint`.
 */
contract MockEIP3009Token {
    string public name;
    string public symbol = "mUSDC";
    string public version = "2";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /** Nonce EIP-3009 bersifat sekali-pakai per pemberi otorisasi. */
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor(string memory _name) {
        name = _name;
    }

    /// Dihitung saat dipanggil, jadi tidak mungkin melenceng dari yang dipakai validasi.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    block.chainid,
                    address(this)
                )
            );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // Pesan revert-nya mengikuti EIP-3009 supaya facilitator bisa diuji terhadap
        // pembedaan yang sama seperti yang akan dihadapinya di token sungguhan.
        require(block.timestamp > validAfter, "EIP3009: authorization is not yet valid");
        require(block.timestamp < validBefore, "EIP3009: authorization is expired");
        require(!authorizationState[from][nonce], "EIP3009: authorization is used or canceled");

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
                )
            )
        );
        require(ecrecover(digest, v, r, s) == from, "EIP3009: invalid signature");
        require(balanceOf[from] >= value, "EIP3009: insufficient balance");

        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit AuthorizationUsed(from, nonce);
        emit Transfer(from, to, value);
    }
}
