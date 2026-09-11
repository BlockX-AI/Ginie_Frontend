"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
// import { useAccount } from "wagmi";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  ChatInputBox,
  StatusBadge,
  PromotionBanner,
  type DeploymentMode,
} from "@/components/chat";
import { AlertCircle, HelpCircle, Wallet, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WalletDeployModal } from "@/components/chat/WalletDeployModal";
import HeroHeader from "@/components/HeroHeader";

// Updated for webbuilder-main integration
export default function ChatPageContent() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>("dapp");
  const [gameMode, setGameMode] = useState(false);
  const [walletDeployModalOpen, setWalletDeployModalOpen] = useState(false);
  const [walletDeployJobId, setWalletDeployJobId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPromptConsumedRef = useRef(false);
  const { entitlements, isPro } = useAuth();
  // const { address, isConnected } = useAccount();
  const address = null;
  const isConnected = false;

  // Pro users have wallet deployment access (check both wallet_deployments and pro_enabled)
  const hasWalletEntitlement = entitlements?.wallet_deployments === true || entitlements?.pro_enabled === true || isPro;
  // Pro users can create full DApps (contract + frontend)
  const hasDappEntitlement = entitlements?.pro_enabled === true || isPro;

  const submitPrompt = useCallback(
    async (prompt: string, modeOverride?: DeploymentMode) => {
      const trimmed = prompt.trim();
      if (!trimmed || isLoading) return;

      const modeToUse = modeOverride ?? deploymentMode;

      setIsLoading(true);
      setError("");

      try {
        if (modeToUse === "wallet") {
          // Wallet deployment flow
          if (!isConnected || !address) {
            setError("Please connect your wallet first");
            return;
          }

          const walletPromptPreamble =
            "You are generating a production-ready Solidity smart contract for deployment.\n" +
            "Hard requirements (must follow):\n" +
            "1) Add SPDX header as the FIRST line: // SPDX-License-Identifier: UNLICENSED\n" +
            "2) Add a pragma like: pragma solidity ^0.8.20;\n" +
            "3) NEVER mark a function `pure` if it reads contract storage (mappings/arrays/structs/state vars) or msg.sender/block.timestamp/etc.\n" +
            "   - If it reads state: use `view`.\n" +
            "   - If it writes state: use no mutability modifier.\n" +
            "4) No pseudo-code. Output only valid Solidity.\n" +
            "\n";

          const callbackUrl = typeof window !== "undefined" ? `${window.location.origin}/chat` : undefined;
          const result = await api.walletDeploy({
            prompt: walletPromptPreamble + trimmed,
            network: "avalanche-fuji", //  Network
            callbackUrl,
            strictArgs: true,
            constructorArgs: [],
          });

          if (result.jobId) {
            setWalletDeployJobId(result.jobId);
            setWalletDeployModalOpen(true);
            setInput("");
          } else {
            throw new Error("Failed to start wallet deployment");
          }
        } else if (modeToUse === "frontend") {
          // Frontend-only creation flow: React website (no blockchain)
          if (!hasDappEntitlement) {
            setError("Frontend creation requires Pro subscription. Please upgrade your plan.");
            return;
          }
          const result = await api.builderCreateProject({
            prompt: trimmed,
          });
          const projectId =
            (result as any)?.project?.id ||
            (result as any)?.id ||
            (result as any)?.jobId;
          if (projectId) {
            setInput("");
            router.push(`/chat/${encodeURIComponent(projectId)}?mode=frontend`);
          } else {
            throw new Error("Failed to start frontend creation");
          }
        } else if (modeToUse === "dapp") {
          // Full DApp creation flow: contract + React frontend
          if (!hasDappEntitlement) {
            setError("DApp creation requires Pro subscription. Please upgrade your plan.");
            return;
          }
          const result = await api.builderCreateDapp({
            prompt: trimmed,
            network: "avalanche-fuji",
            game_mode: gameMode,
          });
          const dappId =
            (result as any)?.project?.id ||
            (result as any)?.dapp?.id ||
            (result as any)?.id ||
            (result as any)?.jobId;
          if (dappId) {
            setInput("");
            router.push(`/chat/${encodeURIComponent(dappId)}?mode=dapp`);
          } else {
            throw new Error("Failed to start DApp creation");
          }
        } else {
          // Normal deployment flow
          const makePayload = (network: string) => ({
            prompt: trimmed,
            network,
            maxIters: 3,
            filename: "SimpleStorage.sol",
            strictArgs: true,
            constructorArgs: [],
            jobKind: "pipeline",
            providedName: "",
          });
          try {
            const started = await api.startPipeline(makePayload("avalanche-fuji"));
            console.log("Pipeline started response:", started);
            const jid = (started as any)?.chat_id || (started as any)?.job?.id;
            console.log("Extracted job ID:", jid);
            if (!jid) {
              console.error("No job ID in response:", started);
              throw new Error("Failed to start job - no chat_id in response");
            }
            router.push(`/chat/${encodeURIComponent(jid)}`);
            return;
          } catch (e1: any) {
            console.error("Pipeline start error:", e1);

            if (e1?.status === 400) {
              const started2 = await api.startPipeline(makePayload("avalanche-fuji"));
              const jid2 = (started2 as any)?.chat_id || (started2 as any)?.job?.id;
              if (!jid2) throw new Error("Failed to start job");
              router.push(`/chat/${encodeURIComponent(jid2)}`);
              return;
            }
            throw e1;
          }
        }
      } catch (err: any) {
        if (err?.code === "forbidden") {
          if (modeToUse === "wallet" && hasWalletEntitlement) {
            setError("Wallet deployment request was rejected (403). Please refresh and try again.");
          } else if (modeToUse === "dapp" && hasDappEntitlement) {
            setError("DApp creation request was rejected (403). Please refresh and try again.");
          } else if (modeToUse === "frontend" && hasDappEntitlement) {
            setError("Frontend creation request was rejected (403). Please refresh and try again.");
          } else {
            setError(
              modeToUse === "dapp"
                ? "DApp creation requires Pro subscription. Please upgrade your plan."
                : modeToUse === "frontend"
                ? "Frontend creation requires Pro subscription. Please upgrade your plan."
                : "Wallet deployment requires Pro subscription. Please upgrade your plan.",
            );
          }
        } else {
          setError(err?.message || "Request failed. Please try again.");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [address, deploymentMode, hasWalletEntitlement, hasDappEntitlement, isConnected, isLoading, router]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPrompt(input);
  };

  // Support deep-linking with an initial prompt, e.g. /chat?prompt=hello
  useEffect(() => {
    const initialPrompt = searchParams?.get("prompt") ?? "";
    if (!initialPrompt.trim()) return;
    if (initialPromptConsumedRef.current) return;
    if (isLoading) return;

    initialPromptConsumedRef.current = true;

    const modeParam = searchParams?.get("mode");
    const modeOverride: DeploymentMode | undefined =
      modeParam === "wallet" ? "wallet" : modeParam === "dapp" ? "dapp" : modeParam === "frontend" ? "frontend" : modeParam === "normal" ? "normal" : undefined;
    if (modeOverride) setDeploymentMode(modeOverride);

    setInput(initialPrompt);
    void submitPrompt(initialPrompt, modeOverride);
  }, [isLoading, searchParams, submitPrompt]);

  const handleWalletDeployComplete = (jobId: string) => {
    setWalletDeployModalOpen(false);
    router.push(`/chat/${encodeURIComponent(jobId)}`);
  };

  return (
    <div className="min-h-screen w-full relative bg-black">
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(226, 232, 240, 0.15), transparent 70%), #000000",
        }}
      />

      {/* Fixed header at top center */}
      <HeroHeader />

      {/* Decorative rounded image behind content */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <div
          className="w-[1100px] max-w-[92%] h-[520px] md:h-[520px] lg:h-[640px] rounded-3xl overflow-hidden shadow-2xl opacity-30 md:opacity-40 lg:opacity-45"
          style={{
            backgroundImage: "url('https://framerusercontent.com/images/Wne6ywIpp0BwY8GoBBoZlZEoC9g.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            margin: '0 12px',
            filter: 'saturate(0.95) blur(6px)'
          }}
        />
      </div>

      <div className="relative z-10 min-h-[calc(100vh-60px)] flex flex-col items-center justify-center px-4">


        <div className="mb-12">
          <h1 className="text-center tracking-tight">
            <span className="font-playfair italic font-light text-5xl sm:text-6xl md:text-7xl gradient-text">
              Ginie.
            </span>
          </h1>
        </div>

        <div className="w-full max-w-2xl">
          <ChatInputBox
            input={input}
            isLoading={isLoading}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            deploymentMode={deploymentMode}
            onDeploymentModeChange={setDeploymentMode}
            hasWalletEntitlement={hasWalletEntitlement}
            hasDappEntitlement={hasDappEntitlement}
            showWalletConnect={true}
            gameMode={gameMode}
            onGameModeChange={setGameMode}
          />

          {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{error}</p>
                  {error.includes('wallet') && (
                    <p className="text-red-300/70 text-xs mt-2">
                      Make sure you have MetaMask or another Web3 wallet installed and connected.
                    </p>
                  )}
                  {error.includes('Pro') && (
                    <p className="text-red-300/70 text-xs mt-2">
                      <Link href="/subscription" className="underline hover:text-red-300">Upgrade to Pro</Link> to unlock wallet-based deployments and advanced features.
                    </p>
                  )}
                  {error.includes('failed') && !error.includes('wallet') && (
                    <p className="text-red-300/70 text-xs mt-2">
                      Please try again. If the problem persists, check your network connection or contact support.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Helpful tips for users */}
          <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-white/60 space-y-2">
                <p><strong className="text-white/80">Tips for better results:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-1">
                  <li>Be specific about what your smart contract should do</li>
                  <li>Mention any specific features like access control, upgradability, or token standards</li>
                  {!isPro && (
                    <li className="text-amber-400/80">
                      <Link href="/subscription" className="underline hover:text-amber-300">
                        Upgrade to Pro
                      </Link>{" "}
                      to deploy contracts from your own wallet
                    </li>
                  )}
                  {isPro && <li>For wallet deployment, ensure your wallet is connected first</li>}
                </ul>
                {!isPro && (
                  <div className="pt-1">
                    <Link href="/subscription" className="inline-flex items-center text-xs font-medium text-white/80 underline hover:text-white">
                      Request Early Access
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>


      </div>

      {walletDeployJobId && (
        <WalletDeployModal
          open={walletDeployModalOpen}
          onOpenChange={setWalletDeployModalOpen}
          jobId={walletDeployJobId}
          onComplete={handleWalletDeployComplete}
        />
      )}
    </div>
  );
}
