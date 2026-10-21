"use client";

import React, { useState } from "react";
import { Eye, Trash2, Lock, PlusCircle, Server } from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { decryptKeystoreSecret } from "@/lib/crypto/keystore";
import { CHAIN_METADATA } from "@/lib/chains/config";
import { resolveOnChainERC20Token } from "@/lib/tokens/registry";

export default function SettingsView() {
  const {
    keystore,
    activeChainId,
    customRpcs,
    setCustomRpc,
    addCustomToken,
    currency,
    setCurrency,
    theme,
    setTheme,
    lockWallet,
    resetWallet,
  } = useWalletStore();

  const [rpcInput, setRpcInput] = useState<string>(
    customRpcs[activeChainId] || ""
  );
  const [tokenAddr, setTokenAddr] = useState<string>("");
  const [revealPassword, setRevealPassword] = useState<string>("");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleRevealSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keystore) return;
    try {
      const secret = await decryptKeystoreSecret(keystore, revealPassword);
      setRevealedSecret(secret);
      setRevealPassword("");
    } catch (err: unknown) {
      setStatusMsg(err instanceof Error ? err.message : "Wrong password");
    }
  };

  const handleAutoImportToken = async () => {
    if (!tokenAddr) return;
    setStatusMsg("Reading token metadata from blockchain...");
    const resolved = await resolveOnChainERC20Token(
      activeChainId,
      tokenAddr,
      customRpcs[activeChainId]
    );
    if (!resolved) {
      setStatusMsg("Could not resolve ERC-20 contract on this network.");
      return;
    }
    addCustomToken(resolved);
    setTokenAddr("");
    setStatusMsg(`Added ${resolved.name} (${resolved.symbol}) with live logo!`);
  };

  return (
    <div className="space-y-5 pb-28">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Wallet Settings</h2>
        <button
          onClick={lockWallet}
          className="px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5"
        >
          <Lock className="w-3.5 h-3.5" /> Lock Now
        </button>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs">
          {statusMsg}
        </div>
      )}

      {/* Currency & 3-Theme Appearance Selector */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-slate-400 font-bold">
            Display Currency
          </label>
          <select
            value={currency}
            onChange={(e) =>
              setCurrency(e.target.value as "USD" | "EUR" | "GBP")
            }
            className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 font-bold block">
            Appearance Theme (3 Modes)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                {
                  id: "dark",
                  label: "Obsidian Dark",
                  swatch: "bg-[#07090E] border-indigo-500/40",
                  dot: "bg-indigo-400",
                },
                {
                  id: "light",
                  label: "Crystal Daylight",
                  swatch: "bg-[#F8FAFC] border-slate-300",
                  dot: "bg-indigo-600",
                },
                {
                  id: "aether",
                  label: "Aether Cyber",
                  swatch: "bg-[#120726] border-fuchsia-500/50",
                  dot: "bg-cyan-400",
                },
              ] as const
            ).map((item) => {
              const active = theme === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTheme(item.id)}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1.5 ${
                    active
                      ? "border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/10"
                      : "border-slate-800 bg-slate-950/60 opacity-80 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`w-5 h-5 rounded-full border ${item.swatch} flex items-center justify-center`}
                    >
                      <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                    </span>
                    {active && (
                      <span className="text-[10px] font-extrabold text-indigo-400">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Custom RPC Override */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5">
        <div className="text-xs font-bold flex items-center gap-1.5">
          <Server className="w-4 h-4 text-indigo-400" />
          <span>Custom RPC ({CHAIN_METADATA[activeChainId].name})</span>
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            value={rpcInput}
            onChange={(e) => setRpcInput(e.target.value)}
            placeholder="https://..."
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
          />
          <button
            onClick={() => {
              setCustomRpc(activeChainId, rpcInput);
              setStatusMsg("Custom RPC saved.");
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold"
          >
            Save
          </button>
        </div>
      </div>

      {/* 1-Click Auto-Resolving Custom Token Importer */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5">
        <div className="text-xs font-bold flex items-center gap-1.5">
          <PlusCircle className="w-4 h-4 text-emerald-400" />
          <span>Auto-Import Custom ERC-20 Token</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste 0x Contract Address..."
            value={tokenAddr}
            onChange={(e) => setTokenAddr(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
          />
          <button
            onClick={handleAutoImportToken}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
          >
            Auto-Detect
          </button>
        </div>
      </div>

      {/* Reveal Recovery Phrase with Password Re-Entry */}
      <form
        onSubmit={handleRevealSeed}
        className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5"
      >
        <div className="text-xs font-bold flex items-center gap-1.5">
          <Eye className="w-4 h-4 text-indigo-400" />
          <span>Reveal Recovery Phrase / Private Key</span>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={revealPassword}
            onChange={(e) => setRevealPassword(e.target.value)}
            placeholder="Re-enter vault password"
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold"
          >
            Decrypt
          </button>
        </div>
        {revealedSecret && (
          <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 font-mono text-xs text-amber-300 break-all">
            {revealedSecret}
          </div>
        )}
      </form>

      {/* Danger Zone: Wipe Wallet */}
      <button
        onClick={() => {
          if (
            window.confirm(
              "Wipe encrypted keystore from this device? Ensure you have backed up your recovery phrase."
            )
          ) {
            resetWallet();
          }
        }}
        className="w-full py-3 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold flex items-center justify-center gap-2"
      >
        <Trash2 className="w-4 h-4" /> Reset & Wipe Wallet Keystore
      </button>
    </div>
  );
}
