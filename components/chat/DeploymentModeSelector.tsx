"use client";

import { useState } from "react";
import { Wallet, Rocket, ChevronDown, Check, Loader2, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type DeploymentMode = "normal" | "wallet" | "dapp" | "frontend";

interface DeploymentModeSelectorProps {
  mode: DeploymentMode;
  onModeChange: (mode: DeploymentMode) => void;
  disabled?: boolean;
  hasWalletEntitlement?: boolean;
  hasDappEntitlement?: boolean;
}

export function DeploymentModeSelector({
  mode,
  onModeChange,
  disabled = false,
  hasWalletEntitlement = false,
  hasDappEntitlement = false,
}: DeploymentModeSelectorProps) {
  const modes = [
    {
      id: "dapp" as const,
      label: "Full DApp",
      description: "Deploy smart contract + React frontend on BotChain",
      icon: Boxes,
      available: true,
    },
  ];

  const currentMode = modes.find((m) => m.id === mode) || modes[0];
  const Icon = currentMode.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 bg-white/5 border-white/10 text-white/80 hover:bg-white/10 hover:text-white",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <Icon size={16} />
          <span className="hidden sm:inline">{currentMode.label}</span>
          <ChevronDown size={14} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(
          "w-64",
          "bg-black/95 border border-white/10 text-white",
          "backdrop-blur-xl"
        )}
      >
        {modes.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => m.available && onModeChange(m.id)}
            disabled={!m.available}
            className={cn(
              "flex items-start gap-3 p-3 cursor-pointer",
              "focus:bg-white/10 data-[highlighted]:bg-white/10",
              "hover:bg-white/5",
              !m.available && "opacity-60 cursor-not-allowed"
            )}
          >
            <m.icon size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.label}</span>
                {mode === m.id && <Check size={14} className="text-green-500" />}
              </div>
              <p className="text-xs text-white/60 mt-0.5">
                {m.description}
              </p>
              {!m.available && (
                <p className="text-xs text-amber-400 mt-1">
                  Requires Pro subscription
                </p>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
