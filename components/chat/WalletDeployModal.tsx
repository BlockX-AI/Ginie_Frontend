"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain, useChainId } from "wagmi";
import { avalancheFuji } from "@/components/web3/WalletProvider";
import { parseEther, parseGwei } from "viem";
import { Loader2, CheckCircle, AlertCircle, Wallet, ExternalLink, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { WalletSignSession } from "@/lib/api";

type DeployStep = "polling" | "ready" | "signing" | "submitted" | "confirmed" | "error";

interface WalletDeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  onComplete: (jobId: string) => void;
}

export function WalletDeployModal({
  open,
  onOpenChange,
  jobId,
  onComplete,
}: WalletDeployModalProps) {
  const [step, setStep] = useState<DeployStep>("polling");
  const [session, setSession] = useState<WalletSignSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [verificationState, setVerificationState] = useState<"idle" | "pending" | "verified" | "failed">("idle");
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const verificationPersistedRef = useRef(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { sendTransaction, isPending: isSending, data: sentTxHash } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: sentTxHash,
  });

  // Use Avalanche Fuji (43113) as default - the session may have chainId in unsignedTx or at top level
  const requiredChainId = session?.unsignedTx?.chainId || session?.chainId || avalancheFuji.id;
  const isWrongChain = isConnected && chainId !== requiredChainId;

  const networkLabel =
    requiredChainId === avalancheFuji.id
      ? "Avalanche Fuji"
      : session?.networkName || session?.network || "Avalanche Fuji";

  // Poll for session to be ready
  const pollForSession = useCallback(async () => {
    if (!jobId) return;

    try {
      // First check job status to get session ID
      const status = await api.jobStatus(jobId);
      const jobData = (status as any)?.data;
      const jobState = jobData?.state;

      const addr = jobData?.cache?.address || jobData?.result?.address || jobData?.result?.contractAddress;
      if (typeof addr === "string" && addr) setContractAddress(addr);

      // Check if job failed
      if (jobState === "failed" || jobState === "error") {
        const errorMsg = jobData?.error ||
                         jobData?.message ||
                         jobData?.reason ||
                         "Contract generation failed. Please try again.";
        let msg = String(errorMsg);
        if (msg.includes("SPDX") || msg.toLowerCase().includes("license identifier")) {
          msg += "\n\nFix: add `// SPDX-License-Identifier: UNLICENSED` as the first line of your Solidity file.";
        }
        if (msg.includes("declared as pure") && msg.includes("requires \"view\"")) {
          msg += "\n\nFix: change the function modifier from `pure` to `view` (or remove the modifier if the function writes state).";
        }
        setError(msg);
        setStep("error");
        return true;
      }

      // Check if job is ready for signing (pending_signature state)
      // sessionId is in result.sessionId when state is "pending_signature"
      const sessionId = jobData?.result?.sessionId;

      if (sessionId && (jobState === "pending_signature" || jobState === "awaiting_signature")) {
        // Session is ready, fetch details from /api/wallet/sign/{sessionId}
        const sessionData = await api.walletSignSession(sessionId);

        // Merge job result data with session data for display
        const mergedSession = {
          ...sessionData,
          contractName: sessionData.contractName || jobData?.result?.contractName,
          network: sessionData.network || jobData?.result?.network,
          networkName: sessionData.networkName || jobData?.result?.network,
          estimatedGas: sessionData.estimatedGas || jobData?.result?.estimatedGas,
        };

        setSession(mergedSession);
        setStep("ready");
        return true;
      }

      return false;
    } catch (err: any) {
      // Keep polling if session not ready yet
      if (err?.status === 404) {
        return false;
      }
      console.error("Error polling for session:", err);
      return false;
    }
  }, [jobId]);

  // Polling effect
  useEffect(() => {
    if (!open || step !== "polling") return;

    const interval = setInterval(async () => {
      setPollCount((c) => c + 1);
      const done = await pollForSession();
      if (done) {
        clearInterval(interval);
      }
    }, 3000);

    // Initial poll
    pollForSession();

    return () => clearInterval(interval);
  }, [open, step, pollForSession]);

  useEffect(() => {
    if (open) return;
    setContractAddress(null);
    setVerificationState("idle");
    setVerificationUrl(null);
    verificationPersistedRef.current = false;
  }, [open]);

  // Handle transaction sent
  useEffect(() => {
    if (sentTxHash && step === "signing") {
      setTxHash(sentTxHash);
      setStep("submitted");

      // Submit to backend
      if (session?.sessionId && address) {
        api.walletSubmitTx(session.sessionId, sentTxHash, address)
          .catch((err) => {
            console.error("Failed to submit tx to backend:", err);
          });
      }
    }
  }, [sentTxHash, step, session?.sessionId, address]);

  useEffect(() => {
    if (!isConfirmed) return;
    if (step !== "submitted") return;
    setStep("confirmed");
    setVerificationState("pending");

    let cancelled = false;
    (async () => {
      try {
        const network = session?.network || session?.networkName || "avalanche-fuji";
        let foundAddr: string | null = null;
        for (let i = 0; i < 24; i++) {
          if (cancelled) return;
          try {
            const st = await api.jobStatus(jobId);
            const d = (st as any)?.data;
            const addr = d?.cache?.address || d?.result?.address || d?.result?.contractAddress;
            if (typeof addr === "string" && addr) {
              setContractAddress(addr);
              foundAddr = addr;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 5000));
        }

        if (cancelled) return;
        try {
          await api.verifyByJob(jobId, network);
        } catch (e: any) {
          if (foundAddr) {
            try { await api.verifyByAddress(foundAddr, network); } catch {}
          }
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConfirmed, step, jobId, session?.network, session?.networkName, contractAddress]);

  useEffect(() => {
    if (!open) return;
    if (step !== "confirmed") return;
    if (!contractAddress) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const network = session?.network || session?.networkName || "avalanche-fuji";
        const res = await api.verifyStatus(contractAddress, network);
        if (cancelled) return;
        if (res?.verified) {
          setVerificationState("verified");
          if (!verificationPersistedRef.current) {
            verificationPersistedRef.current = true;
            try {
              await api.updateJobCache({
                jobId,
                state: "completed",
                verified: true,
                address: contractAddress,
                explorer_url: res?.explorerUrl,
              });
            } catch {}
          }
        } else {
          setVerificationState("pending");
        }
        setVerificationUrl(res?.explorerUrl || null);
      } catch (e) {
        if (cancelled) return;
        setVerificationState("failed");
      }
    };

    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, step, contractAddress, session?.network, session?.networkName]);

  const handleSign = async () => {
    if (!session?.unsignedTx || !isConnected) return;

    try {
      setStep("signing");
      setError(null);

      const tx = session.unsignedTx;
      sendTransaction({
        to: tx.to as `0x${string}` | undefined,
        data: tx.data as `0x${string}`,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        chainId: tx.chainId,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to sign transaction");
      setStep("error");
    }
  };

  const handleSwitchChain = async () => {
    // Determine chain config based on requiredChainId
    const getChainConfig = (chainId: number) => {
      if (chainId === avalancheFuji.id) {
        return {
          chainId: `0x${chainId.toString(16)}`,
          chainName: "Avalanche Fuji Testnet",
          nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
          rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
          blockExplorerUrls: ["https://testnet.snowtrace.io"],
        };
      }
      return {
        chainId: `0x${chainId.toString(16)}`,
        chainName: "Base Sepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://sepolia.base.org"],
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      };
    };

    try {
      await switchChain({ chainId: requiredChainId });
    } catch (err: any) {
      console.error("Failed to switch chain:", err);
      // If chain not added, try to add it manually via MetaMask
      if (err?.code === 4902 || err?.message?.includes("Unrecognized chain") || err?.message?.includes("not configured")) {
        try {
          const ethereum = (window as any).ethereum;
          if (ethereum) {
            const chainConfig = getChainConfig(requiredChainId);
            await ethereum.request({
              method: "wallet_addEthereumChain",
              params: [chainConfig],
            });
          }
        } catch (addErr) {
          console.error("Failed to add chain:", addErr);
        }
      }
    }
  };

  const handleComplete = () => {
    onComplete(jobId);
  };

  const handleClose = () => {
    if (step === "confirmed") {
      handleComplete();
    } else {
      onOpenChange(false);
    }
  };

  const getExplorerUrl = (hash: string) => {
    // Use the correct explorer based on the chain
    if (requiredChainId === avalancheFuji.id) {
      return `https://testnet.snowtrace.io/tx/${hash}`;
    }
    return `https://testnet.snowtrace.io/tx/${hash}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Wallet Deployment
          </DialogTitle>
          <DialogDescription>
            {step === "polling" && "Preparing your contract for deployment..."}
            {step === "ready" && "Review and sign the deployment transaction"}
            {step === "signing" && "Please sign the transaction in your wallet"}
            {step === "submitted" && "Transaction submitted, waiting for confirmation..."}
            {step === "confirmed" && "Contract deployed successfully!"}
            {step === "error" && "An error occurred"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Polling State */}
          {step === "polling" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Generating and compiling your contract...
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This may take a minute
                </p>
              </div>
              {pollCount > 5 && (
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <Clock className="h-3 w-3" />
                  Still working... ({pollCount * 3}s)
                </div>
              )}
            </div>
          )}

          {/* Ready State */}
          {step === "ready" && session && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                {session.contractName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Contract</span>
                    <span className="font-medium">{session.contractName}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium">{networkLabel}</span>
                </div>
                {session.estimatedGas && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Est. Gas</span>
                    <span className="font-medium">{session.estimatedGas} ETH</span>
                  </div>
                )}
              </div>

              {isWrongChain ? (
                <Button
                  onClick={handleSwitchChain}
                  disabled={isSwitching}
                  className="w-full"
                  variant="outline"
                >
                  {isSwitching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Switching Network...
                    </>
                  ) : (
                    <>
                      <AlertCircle className="mr-2 h-4 w-4" />
                      <span className="whitespace-nowrap">Switch to {networkLabel}</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleSign} disabled={isSending} className="w-full">
                  {isSending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Waiting for signature...
                    </>
                  ) : (
                    <>
                      <Wallet className="mr-2 h-4 w-4" />
                      Sign & Deploy
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Signing State */}
          {step === "signing" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <p className="text-sm text-muted-foreground text-center">
                Please confirm the transaction in your wallet
              </p>
            </div>
          )}

          {/* Submitted State */}
          {step === "submitted" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-green-500" />
              <div className="text-center">
                <p className="text-sm font-medium">Transaction Submitted</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Waiting for blockchain confirmation...
                </p>
              </div>
              {txHash && (
                <a
                  href={getExplorerUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                >
                  View on Explorer
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Confirmed State */}
          {step === "confirmed" && (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <div className="text-center">
                <p className="text-lg font-medium">Deployment Successful!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your contract has been deployed to the blockchain
                </p>
              </div>

              {/* Contract Details Card */}
              <div className="w-full bg-muted/50 rounded-lg p-4 space-y-3">
                {session?.contractName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Contract</span>
                    <span className="font-medium">{session.contractName}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium">{networkLabel}</span>
                </div>
                {contractAddress && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Address</span>
                    <span className="font-mono text-xs">{contractAddress}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Verification</span>
                  <span
                    className={
                      verificationState === "verified"
                        ? "font-medium text-green-500"
                        : verificationState === "failed"
                        ? "font-medium text-red-500"
                        : verificationState === "pending"
                        ? "font-medium text-amber-500"
                        : "font-medium text-muted-foreground"
                    }
                  >
                    {verificationState === "verified"
                      ? "Verified"
                      : verificationState === "failed"
                      ? "Failed"
                      : verificationState === "pending"
                      ? "Pending"
                      : "Not started"}
                  </span>
                </div>
                {verificationUrl && (
                  <a
                    href={verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-end gap-1 text-xs text-blue-500 hover:underline"
                  >
                    View verification
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {txHash && (
                <a
                  href={getExplorerUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-500 hover:underline"
                >
                  View Transaction on Explorer
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <Button onClick={handleComplete} className="w-full mt-2">
                View Contract Details & Files
              </Button>
            </div>
          )}

          {/* Error State */}
          {step === "error" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <div className="text-center">
                <p className="text-lg font-medium">Deployment Failed</p>
                <p className="text-sm text-red-400 mt-1">{error}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("polling");
                  setError(null);
                  setPollCount(0);
                }}
              >
                Try Again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
