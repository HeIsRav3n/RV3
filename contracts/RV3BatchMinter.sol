// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RV3BatchMinter
 * @notice Owner-gated batch executor. In a single transaction it fires the same
 *         mint calldata `count` times at a target drop contract, so every mint
 *         for a whole batch shares one tx (one nonce, one confirmation) instead
 *         of N separate wallet transactions. Minted NFTs are received by this
 *         contract and can be swept out to any address by the owner.
 *
 *         This is the on-chain half of RV3's "Delegation batch" route. Deploy
 *         one per operator wallet, fund it with (mint cost x count) + gas, then
 *         call batchMint. Sweep the NFTs out and withdraw leftover ETH when done.
 *
 * @dev Deliberately minimal and auditable: no upgradeability, no delegatecall,
 *      no selfdestruct. Only the owner can move funds or execute calls.
 */
contract RV3BatchMinter {
    address public immutable owner;

    event BatchMinted(address indexed target, uint256 count, uint256 succeeded, uint256 spent);
    event Swept721(address indexed collection, address indexed to, uint256 count);
    event Swept1155(address indexed collection, address indexed to, uint256 count);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error BadArgs();
    error NothingSucceeded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    /**
     * @notice Execute `target`'s mint calldata `count` times, sending `valueEach`
     *         wei per call. Non-reverting best effort: a single failed mint (e.g.
     *         supply exhausted) does not roll back the mints that already landed.
     * @param target    the drop / NFT contract to call
     * @param data      raw mint calldata (as produced by the OpenSea SeaDrop API)
     * @param valueEach wei to forward on each individual mint call
     * @param count     how many times to mint
     * @return succeeded number of mint calls that returned success
     */
    function batchMint(
        address target,
        bytes calldata data,
        uint256 valueEach,
        uint256 count
    ) external payable onlyOwner returns (uint256 succeeded) {
        if (target == address(0) || count == 0) revert BadArgs();
        uint256 startBal = address(this).balance;
        for (uint256 i = 0; i < count; i++) {
            (bool ok, ) = target.call{value: valueEach}(data);
            if (ok) {
                unchecked { succeeded++; }
            }
        }
        if (succeeded == 0) revert NothingSucceeded();
        uint256 spent = startBal - address(this).balance;
        emit BatchMinted(target, count, succeeded, spent);
    }

    /**
     * @notice Generic owner-gated call passthrough for one-off interactions
     *         (e.g. setApprovalForAll before an external marketplace sweep).
     */
    function exec(address target, bytes calldata data, uint256 value)
        external
        payable
        onlyOwner
        returns (bytes memory)
    {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        require(ok, "exec failed");
        return ret;
    }

    function sweep721(address collection, uint256[] calldata tokenIds, address to)
        external
        onlyOwner
    {
        if (to == address(0)) revert BadArgs();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            IERC721(collection).safeTransferFrom(address(this), to, tokenIds[i]);
        }
        emit Swept721(collection, to, tokenIds.length);
    }

    function sweep1155(
        address collection,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        address to
    ) external onlyOwner {
        if (to == address(0) || tokenIds.length != amounts.length) revert BadArgs();
        IERC1155(collection).safeBatchTransferFrom(address(this), to, tokenIds, amounts, "");
        emit Swept1155(collection, to, tokenIds.length);
    }

    function withdraw(address to) external onlyOwner {
        if (to == address(0)) revert BadArgs();
        uint256 bal = address(this).balance;
        emit Withdrawn(to, bal);
        (bool ok, ) = to.call{value: bal}("");
        require(ok, "withdraw failed");
    }

    // ── ERC receiver hooks so safeMint / safe transfers land here ──
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x150b7a02 || // ERC721Receiver
            interfaceId == 0x4e2312e0;   // ERC1155Receiver
    }
}

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC1155 {
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external;
}
