// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {WethWrapAdapter} from "../src/adapters/WethWrapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";

contract DeployWethAdapter is Script {
    // Sepolia addresses
    address constant WETH_SEPOLIA = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant EXECUTION_ROUTER = 0xC4F16fF20aC73F77A17c502ADCd80794c049ecb2;

    function run() external {
        require(block.chainid == 11155111, "Must be Sepolia");

        uint256 deployerPrivateKey = vm.envUint("RELAYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy WethWrapAdapter
        WethWrapAdapter adapter = new WethWrapAdapter(WETH_SEPOLIA);
        console.log("WethWrapAdapter deployed at:", address(adapter));

        // Add to router allowlist
        ExecutionRouter router = ExecutionRouter(EXECUTION_ROUTER);
        router.setAdapterAllowed(address(adapter), true);
        console.log("Adapter added to router allowlist");

        vm.stopBroadcast();
    }
}
