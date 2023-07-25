import {
    cancelTransactionRequest,
    getUser,
    sendTransactions,
    setURLByNetwork,
    getURL,
} from "./serverRequests";
import detectEthereumProvider from "@metamask/detect-provider";
import {
    getItem,
    setItem,
    removeItem,
    setItemByChainAndIds,
    getItemByChainAndIds,
} from "./localStorage";
import { getNativeCurrency, setNativeCurrency, sleep } from "./miscUtils";
import { RiContactsBookLine } from "react-icons/ri";
import { CustomContract } from "./customContract";
import { useTransactionToast, useErrorToast } from "../hooks/useCustomToast";

const { Network, Alchemy } = require("alchemy-sdk");
const ethers = require("ethers");
const { NETWORK, CHAIN, NETWORK_INFO } = require("../types/networks");

let ethersProvider, alchemy;

let CONTRACT_ADDRESSES = {};

let CONTRACT_ABIS = {};

/**
 * @returns {Array<CHAIN>} Array of compatible networks
 */
export function getCompatibleChains() {
    const compatibleChains = JSON.parse(process.env.REACT_APP_CHAINS);
    return compatibleChains;
}

/**
 * @param {CHAIN} chainId hex string for chain id
 * @returns {NETWORK} network name
 */
export function chainIdToNetwork(chainId) {
    const chainIdToName = {};
    chainIdToName[CHAIN.MAINNET] = NETWORK.MAINNET;
    chainIdToName[CHAIN.POLYGON] = NETWORK.POLYGON;
    chainIdToName[CHAIN.GOERLI] = NETWORK.GOERLI;
    chainIdToName[CHAIN.MUMBAI] = NETWORK.MUMBAI;
    return chainIdToName[chainId];
}

/**
 * @param {CHAIN} chainId
 * @returns {boolean} Whether chainId is correct for this environment
 */
export function isCorrectChainId(chainId) {
    return getCompatibleChains().includes(chainIdToNetwork(chainId));
}

/**
 * @param {NETWORK} network network name
 * @returns {NETWORK_INFO} info about network
 */
export function getChainInfo(network) {
    const ethNativeCurrency = { decimals: 18, symbol: "ETH", name: "ETH" };
    const maticNativeCurrency = { decimals: 18, symbol: "MATIC", name: "MATIC" };
    const info = {};
    const empty = {
        isCustom: null,
        info: {
            chainId: null,
            blockExplorerUrls: [],
            nativeCurrency: null,
            chainName: null,
        },
    };
    info[NETWORK.MAINNET] = {
        isCustom: false,
        info: {
            chainId: CHAIN.MAINNET,
            blockExplorerUrls: ["https://etherscan.io/"],
            nativeCurrency: ethNativeCurrency,
            chainName: "Ethereum",
        },
    };
    info[NETWORK.GOERLI] = {
        isCustom: false,
        info: {
            chainId: CHAIN.GOERLI,
            blockExplorerUrls: ["https://goerli.etherscan.io/"],
            nativeCurrency: ethNativeCurrency,
            chainName: "Goerli",
        },
    };
    info[NETWORK.POLYGON] = {
        isCustom: true,
        info: {
            chainId: CHAIN.POLYGON,
            blockExplorerUrls: [],
            rpcUrls: [process.env.REACT_APP_POLYGON_RPC],
            blockExplorerUrls: ["https://polygonscan.com"],
            nativeCurrency: maticNativeCurrency,
            chainName: "Polygon",
        },
    };
    info[NETWORK.MUMBAI] = {
        isCustom: true,
        info: {
            chainId: CHAIN.MUMBAI,
            rpcUrls: [process.env.REACT_APP_MUMBAI_RPC],
            blockExplorerUrls: ["https://mumbai.polygonscan.com"],
            nativeCurrency: maticNativeCurrency,
            chainName: "Mumbai",
        },
    };
    return info[network] || empty;
}

/**
 * Prompts user to change chainId
 * @param {NETWORK} network name of chain
 * @returns {Promise<null>}
 */
export async function setChainId(network) {
    // NOTE this method is MetaMask specific!
    const { isCustom, info } = getChainInfo(network);
    if (!isCustom) {
        return await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: info.chainId }],
        });
    }

    return await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [info],
    });
}

/**
 * @returns {Promise<CHAIN>} chain id as hex string
 */
export async function getChainId() {
    return await window.ethereum?.request({ method: "eth_chainId" });
}

/**
 * NOTE use getChainId() if possible
 * @returns {CHAIN} chain id as hex string
 */
export function getChainIdLocal() {
    return window.ethereum?.chainId;
}

export function initializeContracts(network) {
    CONTRACT_ADDRESSES = {
        VAULT:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/VaultModule-address.json`)[
            "Module"
            ],
        RENTSTORAGE:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/RentableTokensStorage-address.json`)[
            "Module"
            ],
        PROXYWALLETFACTORY:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/ProxyWalletFactoryModule-address.json`)[
            "Module"
            ],
    };
    CONTRACT_ABIS = {
        ERC20: require("./erc20abi.json"),
        NFT: require("./erc721abi.json"),
        VAULT:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/VaultModule.json`)
                .abi,
        RENTSTORAGE:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/RentableTokensStorage.json`)
                .abi,
        PROXYWALLETFACTORY:
            require(`../../submodules/Z4/frontend/src/contracts/${network}_artifacts/ProxyWalletFactoryModule.json`)
                .abi,
    };
}

/**
 * Initializes Alchemy SDK instance
 * @param {NETWORK} network
 */
export function initializeAlchemy(network) {
    const networks = {};
    networks[NETWORK.GOERLI] = Network.ETH_GOERLI;
    networks[NETWORK.MAINNET] = Network.ETH_MAINNET;
    networks[NETWORK.MUMBAI] = Network.MATIC_MUMBAI;
    networks[NETWORK.POLYGON] = Network.MATIC_MAINNET;

    const settings = {
        apiKey: process.env.REACT_APP_ALCHEMY,
        network: networks[network],
    };
    alchemy = new Alchemy(settings);
}

/**
 * Initializes ethereum provider
 * @param {function} setProvider
 * @param {function} setBlockchainError
 * @param {string} publicKey
 * @param {function} setPublicKey
 * @param {function} setUser
 * @param {function} setProxyWallet
 */
export async function initializeProvider(
    setProvider,
    setBlockchainError,
    publicKey,
    setPublicKey,
    setUser,
    setProxyWallet,
    setTokens,
    setTokensLoading,
    setChangeChain
) {
    const connectHandler = () => {
        setBlockchainError(false);
    };
    const disconnectHandler = (error) => {
        // NOTE disable because it shows error when changing chains.
        // This not necessarily an error.
        // console.log(error);
        // setBlockchainError(true);
    };
    const chainChangedHandler = async (chainId) => {
        const isCorrect = isCorrectChainId(chainId);
        setChangeChain(!isCorrect);
        if (isCorrect) window.location.reload();
    };
    const accountsChangedHandler = async (accounts) => {
        // Confirm chainId is correct first
        if (accounts && accounts.length) {
            const chainId = await getChainId();
            if (!isCorrectChainId(chainId)) {
                setItem("accounts", accounts);
                window.ethereum.emit("chainChanged", chainId);
                return;
            }
        }
        // Login user
        if (accounts && accounts.length && accounts[0] !== publicKey) {
            // Reset states in case user changes accounts and does not sign with new account
            setTokensLoading(true);
            setPublicKey(null);
            setUser(null);
            setProxyWallet(null);
            setTokens(null);
            removeItem("accounts");
            // Fetch and init. states
            const account = accounts[0];
            const { username, proxyWalletAddress: proxyWallet } = await getUser(
                account
            );
            const user = {
                username: username || "Alpha Tester",
                email: "example@mail.com",
                level: 1,
                rank: "Cadet",
                exp: 321,
                remainingRentAmount: 0,
                maxRentAmount: 0,
            };
            let localTokens = getItemByChainAndIds("tokens", [proxyWallet]);
            if (localTokens && localTokens[getNativeCurrency()])
                setTokens(localTokens);
            else {
                localTokens = {};
                localTokens[getNativeCurrency()] = {
                    name: getNativeCurrency(),
                    amount: "0",
                    address: getNativeCurrency(),
                    decimals: null,
                };
                setTokens(localTokens);
            }
            // Get renting info
            const [remainingRentalAmount, maxRentalAmount] =
                await getRentalAmountInfo(proxyWallet);
            user.remainingRentAmount = remainingRentalAmount;
            user.maxRentAmount = maxRentalAmount;
            if (proxyWallet) {
                getAllTokens(proxyWallet, localTokens, setTokens).then(() => {
                    setTokensLoading(false);
                });
            } else {
                setTokensLoading(false);
            }
            setPublicKey(account);
            setProxyWallet(proxyWallet);
            setUser(user);
            setItem("accounts", accounts);
            return;
        }
        setPublicKey(null);
        setUser(null);
        setProxyWallet(null);
        setTokens(null);
        removeItem("accounts");
    };
    try {
        const provider = await detectEthereumProvider();
        if (!provider) return;
        provider.removeAllListeners();
        provider.on("connect", connectHandler);
        provider.on("disconnect", disconnectHandler);
        provider.on("chainChanged", chainChangedHandler);
        const chainId = await getChainId();
        if (!isCorrectChainId(chainId)) {
            window.ethereum.emit("chainChanged", chainId);
        } else {
            const network = chainIdToNetwork(chainId);
            initializeContracts(network);
            setURLByNetwork(network);
            setNativeCurrency(network);
            initializeAlchemy(network);
        }
        provider.on("accountsChanged", accountsChangedHandler);
        ethersProvider = new ethers.providers.Web3Provider(provider);
        // ethersProvider = new CustomProvider(provider);
        setProvider(ethersProvider);
    } catch (error) {
        console.log("initialize provider error", error);
    }
}

/**
 * Connect to user's metamask
 * @param {function} setLoading
 * @param {boolean} eager Whether to eager connect
 */
export async function connectToAccount(publicKey, setLoading, eager) {
    setLoading(true);
    let accounts;
    try {
        if (eager) {
            const accounts = getItem("accounts");
            const availableAccounts = await window.ethereum.request({
                method: "eth_accounts",
            });
            if (
                !accounts ||
                !availableAccounts ||
                !availableAccounts.length ||
                accounts[0] !== availableAccounts[0]
            ) {
                setLoading(false);
                return;
            }
            window.ethereum.emit("accountsChanged", availableAccounts || []);
        } else {
            accounts = await ethersProvider.send("eth_accounts");
            if (!accounts.length) {
                accounts = await ethersProvider.send("eth_requestAccounts", []);
            } else {
                window.ethereum.emit("accountsChanged", accounts || []);
            }
        }
    } catch (error) {
        console.log("connect to account error", error);
        setLoading(false);
    }
}

/**
 * @param {string} proxyWallet User's proxy wallet address
 * @returns {Promise<Number, Number>} Remaining rental amount and max rental amount
 */
export async function getRentalAmountInfo(proxyWallet) {
    try {
        const vault = new CustomContract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider
        );
        const maxRentalAmount = ethers.utils.formatEther(
            (await vault.callWithRetry("getMaxRentalAmount", [])) || "0"
        );
        let currentRentalAmount;
        if (proxyWallet)
            currentRentalAmount = ethers.utils.formatEther(
                (await vault.callWithRetry("getRentalAmount", [proxyWallet])) || "0"
            );
        else currentRentalAmount = 0;
        return [maxRentalAmount - currentRentalAmount, maxRentalAmount];
    } catch (error) {
        console.log("get remaining rental amount error", error);
        return [0, 0];
    }
}

/**
 * Gets ethereum balance
 * @param {string} account Account to get balance for
 * @returns {*} Token info on ETH
 */
export async function getEthBalance(account, tokens, setTokens) {
    try {
        const eth = account ? await ethersProvider.getBalance(account) : 0;
        const amount = ethers.utils.formatEther(eth);
        if (setTokens) {
            tokens[getNativeCurrency()] = {
                name: getNativeCurrency(),
                amount,
                address: getNativeCurrency(),
            };
            setTokens({ ...tokens });
            setItemByChainAndIds("tokens", [account], tokens);
        }
        return {
            name: getNativeCurrency(),
            address: getNativeCurrency(),
            amount,
        };
    } catch (error) {
        console.log("get eth balance error");
        console.log(error);
    }
}

/**
 * Send ethereum
 * @param {string} from
 * @param {string} to
 * @param {Number} amount
 * @returns {Promise<TransactionResponse>}
 */
export async function sendEth(from, to, amount) {
    if (!from || !to) return;
    return await ethersProvider.getSigner().sendTransaction({
        to: to,
        value: ethers.utils.parseEther(amount, "ether"), // Don't need conversion b/c raw string typed in by user
    });
}

/**
 * Withdraw ethereum from proxywallet
 * @param {string} proxyWallet
 * @param {string} to
 * @param {Number} amount
 * @returns {Promise<TransactionResponse>}
 */
export async function withdrawEth(proxyWallet, to, amount) {
    if (!to) return;
    const tx = {
        from: proxyWallet,
        to: to,
        value: ethers.utils.hexStripZeros(
            ethers.utils.parseEther(amount, "ether").toHexString() // Don't need conversion b/c raw string typed in by user
        ),
    };
    // NOTE assume to === user's public key
    const hash = await sendTransactions(to, [tx]);
    return hash;
    // return await ethersProvider.getTransaction(hash);
}

/**
 * Get ERC 20 amount owned by account
 * @param {string} account Address of account to check
 * @param {string} address Address of token to get
 * @param {Array} tokens
 * @returns {*} Info on token
 */
export async function getERC20(account, address, tokens, setTokens) {
    if (!account) return;
    let tokensCopy = { ...tokens };
    try {
        const contract = new CustomContract(
            address,
            CONTRACT_ABIS["ERC20"],
            ethersProvider
        );
        // const contract = new ethers.Contract(
        //   address,
        //   CONTRACT_ABIS["ERC20"],
        //   ethersProvider
        // );
        if (!tokens[address]) {
            // const decimals = await contract.decimals();
            // const symbol = await contract.symbol();
            const decimals = await contract.callWithRetry("decimals", []);
            const symbol = await contract.callWithRetry("symbol", []);
            tokensCopy[address] = {
                decimals: decimals,
                name: symbol,
                address: address,
            };
        }
        // const balance = await contract.balanceOf(account);
        const balance = await contract.callWithRetry("balanceOf", [account]);
        tokensCopy[address]["amount"] = ethers.utils.formatUnits(
            balance,
            tokensCopy[address]["decimals"]
        );
    } catch (error) {
        console.log("get erc20 error", error);
    }
    if (setTokens) {
        setTokens({ ...tokens });
        setItemByChainAndIds("tokens", [account], tokens);
    }
    return tokensCopy[address];
}

/**
 * Send ERC20 from connected ethereum account
 * @param {string} address Address of token
 * @param {Array} tokens
 * @param {string} to Address to send to
 * @param {Number} amount Amount to send
 * @returns
 */
export async function sendERC20(address, tokens, to, amount) {
    const contract = new ethers.Contract(
        address,
        CONTRACT_ABIS["ERC20"],
        ethersProvider.getSigner()
    );
    return await contract.transfer(
        to,
        ethers.utils.parseUnits(amount, tokens[address]["decimals"])
    );
}

/**
 * Withdraw ERC20 from proxy wallet
 * @param {string} address Address of contract
 * @param {Array} tokens
 * @param {string} publicKey Address to withdraw to
 * @param {string} proxyWallet ProxyWallet to withdraw from
 * @param {Number} amount Amount to send
 * @returns
 */
export async function withdrawERC20(
    address,
    tokens,
    publicKey,
    proxyWallet,
    amount
) {
    if (!publicKey || !proxyWallet) return;
    const tx = { from: proxyWallet, to: address };
    tx.data = (
        await new ethers.Contract(
            address,
            CONTRACT_ABIS["ERC20"],
            ethersProvider
        ).populateTransaction["transfer(address,uint256)"](
            publicKey,
            ethers.utils.parseUnits(amount, tokens[address]["decimals"])
        )
    ).data;
    const hash = await sendTransactions(publicKey, [tx]);
    return hash;
    // return await ethersProvider.getTransaction(hash);
}

/**
 * Updates tokens for account
 * @param {string} account Account to fetch tokens for
 * @param {Array} tokens
 * @param {function} setTokens
 */
export async function getAllTokens(account, tokens, setTokens) {
    const updatedTokens = {};
    for (const symbol in tokens) {
        if (symbol === getNativeCurrency()) {
            updatedTokens[symbol] = await getEthBalance(account);
        } else {
            updatedTokens[symbol] = await getERC20(
                account,
                tokens[symbol]["address"],
                tokens
            );
        }
    }
    if (account) {
        const { tokenBalances } = await alchemy.core.getTokenBalances(account);
        for (const token in tokenBalances) {
            const { contractAddress } = tokenBalances[token];
            if (!updatedTokens[contractAddress])
                updatedTokens[contractAddress] = await getERC20(
                    account,
                    contractAddress,
                    tokens
                );
        }
    }
    if (setTokens) {
        setItemByChainAndIds("tokens", [account], updatedTokens);
        setTokens(updatedTokens);
    }
    return updatedTokens;
}

/**
 * Sends NFT
 * @param {string} publicKey address to send from
 * @param {string} proxyWallet address to send to
 * @param {string} tokenAddress NFT address
 * @param {Number} tokenId NFT id
 * @returns {Promise<TransactionResponse>}
 */
export async function sendNFT(publicKey, proxyWallet, tokenAddress, tokenId) {
    const contract = new ethers.Contract(
        tokenAddress,
        CONTRACT_ABIS["NFT"],
        ethersProvider.getSigner()
    );
    const tx = await contract["safeTransferFrom(address,address,uint256)"](
        publicKey,
        proxyWallet,
        tokenId
    );
    return tx;
}

/**
 * Gets NFTs owned by a proxy wallet
 * @param {string} proxyWallet
 * @returns {Promise<Array, Array>} Rented and deposited NFTs
 */
export async function getWalletNfts(proxyWallet, page) {
    if (!proxyWallet) return [[], []];

    const pageSize = 12;
    let deposits = [];
    let rentals = [];
    const data = await alchemy.nft.getNftsForOwner(proxyWallet);
    // const rentStorage = new ethers.Contract(
    //   CONTRACT_ADDRESSES["RENTSTORAGE"],
    //   CONTRACT_ABIS["RENTSTORAGE"],
    //   ethersProvider
    // );
    const rentStorage = new CustomContract(
        CONTRACT_ADDRESSES["RENTSTORAGE"],
        CONTRACT_ABIS["RENTSTORAGE"],
        ethersProvider
    );
    let count = 0;
    for (const nft of data.ownedNfts) {
        count++;
        if (Math.ceil(count / pageSize) === page) {
            const metaData = await repackageMetadata(nft);
            // const rentEndTime = (
            //   await rentStorage.getLockedTill(
            //     await rentStorage["getTokenId(address,uint256)"](
            //       metaData.address,
            //       metaData.tokenId
            //     )
            //   )
            // ).toNumber();
            const tokenId = await rentStorage.callWithRetry(
                "getTokenId(address,uint256)",
                [metaData.address, metaData.tokenId]
            );
            const rentEndTime = (
                await rentStorage.callWithRetry("getLockedTill", [tokenId])
            ).toNumber();
            if (!rentEndTime) {
                deposits.push(metaData);
            } else {
                rentals.push({
                    ...metaData,
                    end: rentEndTime,
                });
            }
            if (deposits.length + rentals.length === pageSize) {
                break;
            }
        }
    }
    return { rentals, deposits };
}

/**
 * Get count of NFTs owned by wallet
 */
export async function getTotalWalletNfts(walletAddress, type) {
    if (!walletAddress) return 0;

    let retryCount = 0;
    const initialDelay = 1000;
    let rentedCount = 0;
    let ownedCount = 0;

    while (true) {
        try {
            const data = await alchemy.nft.getNftsForOwner(walletAddress);
            // const rentStorage = new ethers.Contract(
            //   CONTRACT_ADDRESSES["RENTSTORAGE"],
            //   CONTRACT_ABIS["RENTSTORAGE"],
            //   ethersProvider
            // );
            const rentStorage = new CustomContract(
                CONTRACT_ADDRESSES["RENTSTORAGE"],
                CONTRACT_ABIS["RENTSTORAGE"],
                ethersProvider
            );
            for (const nft of data.ownedNfts) {
                const metaData = await repackageMetadata(nft);
                // const rentEndTime = (
                //   await rentStorage.getLockedTill(
                //     await rentStorage["getTokenId(address,uint256)"](
                //       metaData.address,
                //       metaData.tokenId
                //     )
                //   )
                // ).toNumber();
                const tokenId = await rentStorage.callWithRetry(
                    "getTokenId(address,uint256)",
                    [metaData.address, metaData.tokenId]
                );
                const rentEndTime = (
                    await rentStorage.callWithRetry("getLockedTill", [tokenId])
                ).toNumber();
                if (!rentEndTime) {
                    ownedCount++;
                } else {
                    rentedCount++;
                }
            }
            break;
        } catch (error) {
            console.log("ERROR", error);
            await sleep(initialDelay * Math.pow(2, retryCount));
            retryCount++;
            // Limit max number of retries to prevent infinite loop
            if (retryCount >= 5) {
                throw new Error("Max retry count reached");
            }
        }
    }
    return type === "rented" ? rentedCount : ownedCount;
}

/**
 * Withdraw NFT from proxy wallet
 * @param {string} publicKey Address to send NFT to
 * @param {string} proxyWallet Proxy wallet to send from
 * @param {string} nftAddress Address of NFT
 * @param {Number} tokenId Id of NFT
 * @returns {Promise<TransactionResponse>}
 */
export async function withdrawNFT(publicKey, proxyWallet, nftAddress, tokenId) {
    const nftContract = new ethers.Contract(
        nftAddress,
        CONTRACT_ABIS["NFT"],
        ethersProvider
    );
    const tx = { from: proxyWallet, to: nftAddress };
    tx.data = (
        await nftContract.populateTransaction[
            "safeTransferFrom(address,address,uint256)"
        ](proxyWallet, publicKey, tokenId)
    ).data;
    const hash = await sendTransactions(publicKey, [tx]);
    return await ethersProvider.getTransaction(hash);
}

/**
 * Gets NFTs owned by vault
 * @param {Array<string>} addresses Addresses of NFTs to check for
 * @returns {Promise<Array>}
 */
export async function getVaultNFTs(addresses, page) {
    if (!addresses || !addresses.length) return [];
    const pageSize = 12;
    const activeNetwork = chainIdToNetwork(await getChainId());
    const owner = CONTRACT_ADDRESSES["VAULT"];

    const nftsIterator = alchemy.nft.getNftsForOwnerIterator(owner, {
        contractAddresses: addresses,
        pageSize,
    });

    let nfts = [];
    let count = 0;
    for await (const nft of nftsIterator) {
        count++;
        if (Math.ceil(count / pageSize) === page) {
            const metaData = await repackageMetadata(nft);
            nfts.push(metaData);
        }
        if (nfts.length === pageSize) {
            break;
        }
    }

    return nfts;
}

/**
 * Get count of NFTs owned by vault
 */
export async function getTotalNFTs(addresses) {
    if (!addresses || !addresses.length) return 0;
    const activeNetwork = chainIdToNetwork(await getChainId());
    const owner = CONTRACT_ADDRESSES["VAULT"];
    const nftsIterator = alchemy.nft.getNftsForOwnerIterator(owner, {
        contractAddresses: addresses,
    });
    let count = 0;
    for await (const _ of nftsIterator) {
        count++;
    }
    return count;
}

function processNfts(nfts, totalCreditUsed) {
    let totalFee = ethers.BigNumber.from(0);
    let nftAddresses = [];
    let tokenIds = [];
    let values = [];
    let creditUsed = [];

    nfts.forEach((nft) => {
        let nftFeeWei = ethers.utils.parseEther(nft.fee.toFixed(18));
        totalFee = totalFee.add(nftFeeWei);
        nftAddresses.push(nft.address);
        tokenIds.push(nft.tokenId);
        values.push(ethers.utils.hexStripZeros(nftFeeWei.toHexString()));

        let nftFeeBigNumber =
            nft.fee < 1e-18 ? ethers.BigNumber.from("0") : nftFeeWei;

        // convert totalCreditUsed to BigNumber for comparison and subtraction
        let totalCreditUsedBigNumber = ethers.BigNumber.from(
            ethers.utils.parseEther(totalCreditUsed.toFixed(18))
        );

        // assign as many credits as possible to each NFT
        if (totalCreditUsedBigNumber.gte(nftFeeBigNumber)) {
            creditUsed.push(nftFeeBigNumber);
            totalCreditUsedBigNumber = totalCreditUsedBigNumber.sub(nftFeeBigNumber);
        } else {
            creditUsed.push(totalCreditUsedBigNumber);
            totalCreditUsedBigNumber = ethers.BigNumber.from("0");
        }

        // Convert back to normal number for the next iteration
        totalCreditUsed = parseFloat(
            ethers.utils.formatEther(totalCreditUsedBigNumber)
        );
    });

    return {
        totalFee: ethers.utils.hexStripZeros(totalFee.toHexString()),
        nftAddresses,
        tokenIds,
        values,
        creditUsed,
    };
}

/**
 * Checkout NFTs from zipzap.
 * NOTE Currently only supports one NFT!
 * @param {string} publicKey
 * @param {string} proxyWallet
 * @param {Array} nfts
 * @returns {Promise<TransactionResponse>}
 */
export async function checkoutNFTs(
    publicKey,
    proxyWallet,
    nfts,
    totalCreditUsed
) {
    console.log(totalCreditUsed);
    if (!nfts) return;
    const vault = new ethers.Contract(
        CONTRACT_ADDRESSES["VAULT"],
        CONTRACT_ABIS["VAULT"],
        ethersProvider
    );

    let txs = [];
    let creditUsed = [];

    if (nfts.length === 1) {
        creditUsed.push(totalCreditUsed);
        const nft = nfts[0];
        let nftFeeWei = ethers.utils.parseEther(nft.fee.toFixed(18));
        const tx = {
            from: proxyWallet,
            to: vault.address,
            value: ethers.utils.hexStripZeros(nftFeeWei.toHexString()),
        };
        tx.data = (
            await vault.populateTransaction["withdraw(address,uint256,uint256)"](
                nft.address,
                nft.tokenId,
                creditUsed[0]
            )
        ).data;
        txs.push(tx);
    } else {
        const { totalFee, nftAddresses, tokenIds, values, creditUsed } =
            processNfts(nfts, totalCreditUsed);
        console.log(creditUsed);
        const tx = { from: proxyWallet, to: vault.address, value: totalFee };
        tx.data = (
            await vault.populateTransaction[
                "withdrawMultiple(address[],uint256[],uint256[],address,uint256[])"
            ](nftAddresses, tokenIds, values, proxyWallet, creditUsed)
        ).data;

        txs.push(tx);
    }

    const hashes = await sendTransactions(publicKey, txs);
    return await ethersProvider.getTransaction(hashes);
}

/**
 * Checkout NFTs using MetaMask wallet
 */
export async function checkoutMetamask(nfts, proxyWallet, totalCreditUsed) {
    const vault = new ethers.Contract(
        CONTRACT_ADDRESSES["VAULT"],
        CONTRACT_ABIS["VAULT"],
        ethersProvider.getSigner()
    );

    const { totalFee, nftAddresses, tokenIds, values, creditUsed } = processNfts(
        nfts,
        totalCreditUsed
    );

    const tx = await vault[
        "withdrawMultiple(address[],uint256[],uint256[],address,uint256[])"
    ](nftAddresses, tokenIds, values, proxyWallet, creditUsed, {
        gasLimit: ethers.utils.hexlify(500000),
    });
    return tx;
}

/**
 * Repackages NFT metadata for display on ZipZap
 * @param {*} nft Nft object
 * @returns {Promise} Repackaged NFT
 */
async function repackageMetadata(nft) {
    // const vault = new ethers.Contract(
    //   CONTRACT_ADDRESSES["VAULT"],
    //   CONTRACT_ABIS["VAULT"],
    //   ethersProvider
    // );
    const vault = new CustomContract(
        CONTRACT_ADDRESSES["VAULT"],
        CONTRACT_ABIS["VAULT"],
        ethersProvider
    );
    const metaData = nft.metadata ?? nft.rawMetadata;
    if (!metaData["attributes"]) {
        metaData["attributes"] = [];
    }
    metaData["tokenId"] = (nft.id && nft.id.tokenId) || nft.tokenId;

    let [price, value] = [null, null];
    // price = ethers.utils.formatEther(
    //   (await vault.getPrice(nft.contract.address, metaData["tokenId"])) || "0"
    // );
    // value = ethers.utils.formatEther(
    //   (await vault.getValue(nft.contract.address, metaData["tokenId"])) || "0"
    // );
    price = ethers.utils.formatEther(
        (await vault.callWithRetry("getPrice", [
            nft.contract.address,
            metaData["tokenId"],
        ])) || "0"
    );
    value = ethers.utils.formatEther(
        (await vault.callWithRetry("getValue", [
            nft.contract.address,
            metaData["tokenId"],
        ])) || "0"
    );

    // const price = await exponentialBackoff(vault.getPrice, nft.contract.address, metaData["tokenId"]);
    // const value = await exponentialBackoff(vault.getValue, nft.contract.address, metaData["tokenId"]);

    metaData.zzVaulted = price !== "0.0" || value !== "0.0";
    metaData.attributes = [
        {
            trait_type: `${getNativeCurrency()} Value`,
            value: Number(value || "0.0"),
        },
        {
            trait_type: `${getNativeCurrency()} Price / Day`,
            value: Number(price || "0.0"),
        },
        ...metaData.attributes,
    ];
    if (metaData.image) {
        const ipfsPrefix = "ipfs://";
        const uri = metaData.image;
        if (
            uri.length >= ipfsPrefix.length &&
            uri.slice(0, ipfsPrefix.length) === ipfsPrefix
        ) {
            metaData.image = "https://ipfs.io/ipfs/" + uri.slice(ipfsPrefix.length);
        }
    }
    return {
        ...metaData,
        address: nft.contract.address,
        uuid: nft.contract.address + metaData.tokenId,
    };
}
/**
 * Helper function to fetch data with retries using exponential backoff
 *
 * @param {function} fetchFn - The function that performs the fetch operation.
 * @param {...any} params - The parameters for the fetch function.
 * @return {Promise<string|null>}
 */
async function exponentialBackoff(fetchFn, ...params) {
    const maxRetries = 5;
    const baseDelay = 250;

    for (let i = 0; i <= maxRetries; i++) {
        try {
            const result = await fetchFn(...params);
            return ethers.utils.formatEther(result || "0");
        } catch (err) {
            if (i < maxRetries) {
                const delay = baseDelay * (1 + Math.random());
                console.log(`Encountered error, retrying fetch after ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                console.error(`Failed to fetch after maximum retries: `, err);
            }
        }
    }
    return null;
}

/**
 * @returns {Promise<Number, Number>} Minimum and maximum vault rental time in seconds
 */
export async function getVaultDurations() {
    // const vaultContract = new ethers.Contract(
    //   CONTRACT_ADDRESSES["VAULT"],
    //   CONTRACT_ABIS["VAULT"],
    //   ethersProvider
    // );
    const vaultContract = new CustomContract(
        CONTRACT_ADDRESSES["VAULT"],
        CONTRACT_ABIS["VAULT"],
        ethersProvider
    );
    const taskList = [
        async () => {
            // return await vaultContract.getMinRentDuration();
            return await vaultContract.callWithRetry("getMinRentDuration", []);
        },
        async () => {
            // return await vaultContract.getMaxRentDuration();
            return await vaultContract.callWithRetry("getMaxRentDuration", []);
        },
    ];
    const tasks = taskList?.map((task) => {
        return task();
    });
    return await Promise.all(tasks);
}

/**
 * @param {string} fromAddress Address to get transactions originating from
 * @param {string} fromBlock Block number to start with in hex
 * @returns {Promise<Array>} Transaction history
 */
export async function getTransactionHistory(fromAddress, fromBlock = "0x0") {
    const { transfers } = await alchemy.core.getAssetTransfers({
        fromBlock,
        fromAddress,
        order: "desc",
        category: ["external", "internal", "erc20", "erc721", "erc1155"],
    });
    return transfers;
}

/**
 * Cancels a transaction
 * @param {string} publicKey
 * @param {string} proxyWallet
 * @param {string} id Id of transaction to cancel
 * @returns
 */
export async function cancelTransaction(publicKey, proxyWallet, id) {
    return await ethersProvider.getTransaction(
        await cancelTransactionRequest(publicKey, proxyWallet, id)
    );
}

/**
 * Using Alchemy, scans and returns ERC20s owned by a given address
 * @param {string} address Address to check for ERC20s
 * @returns {Promise} ERC20s owned by address
 */
export async function getOwnedERC20s(address) {
    const { tokenBalances } = await alchemy.core.getTokenBalances(address);
    const tokens = [];
    for (const token of tokenBalances) {
        const data = await alchemy.core.getTokenMetadata(token.contractAddress);
        tokens.push({ ...token, ...data });
    }
    return tokens;
}

/**
 * @param {string} address Address to check nonce for
 * @returns {Promise<number>} Nonce of the address
 */
export async function getNonce(address) {
    if (!address) return 0;
    return ethersProvider.getTransactionCount(address);
}

/**
 * Checks if NFT belongs to the vault address
 * @param {string} address NFT addresses to check
 * @param {Number} tokenId Id of the NFT
 * @returns {Promise<boolean>}
 */
export async function isNFTInVault(address, tokenId) {
    // const nftContract = new ethers.Contract(
    //   address,
    //   CONTRACT_ABIS["NFT"],
    //   ethersProvider
    // );
    const nftContract = new CustomContract(
        address,
        CONTRACT_ABIS["NFT"],
        ethersProvider
    );
    try {
        // const currentOwner = await nftContract.ownerOf(tokenId);
        const currentOwner = await nftContract.callWithRetry("ownerOf", [tokenId]);
        return currentOwner === CONTRACT_ADDRESSES["VAULT"];
    } catch (error) {
        console.error(`Error checking NFT ownership: ${error.message}`);
        return false;
    }
}

/**
 * @param {string} proxyWallet User's proxy wallet address
 * @returns {Promise<string>} Number of credits the user's proxy wallet has, formatted for display
 */
export async function getCreditBalance(proxyWallet) {
    try {
        const vault = new CustomContract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider
        );
        const balance = await vault.callWithRetry("getRentCredit", [proxyWallet]);
        return balance;
    } catch (error) {
        console.log("get credit balance error", error);
        return ethers.utils.parseEther("0");
    }
}

/**
 * @param {string} proxyWallet User's proxy wallet address
 * @returns {Promise<string>} Address of the referer
 */
export async function getRefererInfo(proxyWallet) {
    try {
        const vault = new CustomContract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider
        );

        let refererAddress;
        if (proxyWallet)
            refererAddress = await vault.callWithRetry("getReferer", [proxyWallet]);
        if (refererAddress === ethers.constants.AddressZero) {
            return 0;
        }
        return refererAddress;
    } catch (error) {
        console.log("get referer info error", error);
        return null;
    }
}

export async function submitReferenceCode(
    publicKey,
    proxyWallet,
    referenceCode,
    options = {}
) {
    try {
        const requestOptions = {
            method: "POST",
            headers: new Headers({
                "Content-Type": "application/x-www-form-urlencoded",
            }),
            body: new URLSearchParams({
                userPublicKey: publicKey,
                referrerProxyWallet: referenceCode,
            }),
            redirect: "follow",
        };
        const response = await fetch(`${getURL()}/users/reference`, requestOptions);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const { uuid, reference } = await response.json();
        const vault = new ethers.Contract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider.getSigner()
        );
        const decoded = Buffer.from(reference, "base64").toString("hex");
        let signature = "0x" + decoded.slice(104);
        const transaction = await vault.setReference(
            referenceCode,
            ethers.BigNumber.from(uuid),
            ethers.utils.arrayify(signature),
            proxyWallet
        );
        const receipt = await transaction.wait();
        if (options.onSuccess) {
            options.onSuccess(receipt);
        }
        return receipt;
    } catch (error) {
        console.error("Error submitting reference code: ", error);
        if (options.onError) {
            options.onError(error);
        }
        return null;
    }
}

export async function getRewardInfo(proxyWallet) {
    try {
        const vault = new CustomContract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider
        );

        let rewardCapPerReference = await vault.callWithRetry(
            "getRewardCapPerReference",
            []
        );
        let refererRewardPercentage = await vault.callWithRetry(
            "getRefererRewardPercentage",
            []
        );
        let refereeRewardPercentage = await vault.callWithRetry(
            "getRefereeRewardPercentage",
            []
        );
        console.log(refererRewardPercentage, refereeRewardPercentage);
        return {
            rewardCapPerReference,
            refererRewardPercentage,
            refereeRewardPercentage,
        };
    } catch (error) {
        console.log("get reward info error", error);
        return null;
    }
}

export async function getIsProxyWalletUser(proxyWallet, publicKey) {
    try {
        const vault = new ethers.Contract(
            CONTRACT_ADDRESSES["VAULT"],
            CONTRACT_ABIS["VAULT"],
            ethersProvider
        );
        return await vault.isProxyWalletUser(proxyWallet, publicKey);
    } catch (error) {
        console.log("get isProxyWalletUser error: ", error);
    }
}
export async function registerNewWallet(user, proxyWallet, signature, toast, errToast) {
    if (!user || !proxyWallet || !signature) return;
    let userWalletData = {};
    try {
        const contract = new ethers.Contract(
            CONTRACT_ADDRESSES["PROXYWALLETFACTORY"],
            CONTRACT_ABIS["PROXYWALLETFACTORY"],
            ethersProvider.getSigner()
        );
        console.log(user, proxyWallet, signature);
        const registerWalletTx = await contract[
            "registerWallet(address,address,bytes)"
        ](user, proxyWallet, signature);
        toast({ description: "Your transaction has been submitted!" });
        await registerWalletTx.wait();
        userWalletData = {
            proxyWallet: proxyWallet,
            account: user,
            registerWalletTx: registerWalletTx,
        };
    } catch (error) {
        console.log("register new wallet error", error);
        throw error;
    }
    return userWalletData;
}