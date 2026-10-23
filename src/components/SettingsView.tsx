"use client";

import React, { useState } from "react";
import {
  Eye,
  EyeOff,
  Trash2,
  Lock,
  PlusCircle,
  Server,
  Copy,
  Check,
  KeyRound,
  FileText,
} from "lucide-react";
import { useWalletStore } from "@/store/useWalletStore";
import { decryptKeystoreSecret } from "@/lib/crypto/keystore";
import {
  deriveAccountFromMnemonic,
  deriveAccountFromPrivateKey,
} from "@/lib/crypto/hdwallet";
import { CHAIN_METADATA } from "@/lib/chains/config";
import { resolveOnChainERC20Token } from "@/lib/tokens/registry";
import { triggerHaptic } from "@/lib/ui/haptics";

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

  // Holds BOTH the 12-word recovery phrase and the derived 0x private key
  const [revealedData, setRevealedData] = useState<{
    mnemonic: string | null;
    privateKey: string;
  } | null>(null);

  const [copiedType, setCopiedType] = useState<"mnemonic" | "privateKey" | null>(
    null
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleRevealSecrets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keystore) return;
    setStatusMsg(null);

    try {
      const rawSecret = await decryptKeystoreSecret(keystore, revealPassword);

      if (keystore.sourceType === "mnemonic") {
        // Derive the exact 0x hex Private Key from the 12-word mnemonic so BOTH are shown!
        const { privateKeyHex } = deriveAccountFromMnemonic(rawSecret);
        setRevealedData({
          mnemonic: rawSecret,
          privateKey: privateKeyHex,
        });
      } else {
        // Wallet was imported using only a raw private key
        const { privateKeyHex } = deriveAccountFromPrivateKey(rawSecret);
        setRevealedData({
          mnemonic: null,
          privateKey: privateKeyHex,
        });
      }

      setRevealPassword("");
      triggerHaptic("success");
    } catch (err: unknown) {
      triggerHaptic("error");
      setStatusMsg(err instanceof Error ? err.message : "Wrong password");
    }
  };

  const copySecret = (text: string, type: "mnemonic" | "privateKey") => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    triggerHaptic("success");
    setTimeout(() => setCopiedType(null), 1800);
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
    setStatusMsg(`Added ${resolved.name} (${resolved.symbol})!`);
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

      {/* Currency & Appearance Dropdowns (Side-by-Side as Requested) */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Display Currency
          </label>
          <select
            value={currency}
            onChange={(e) =>
              setCurrency(e.target.value as "USD" | "EUR" | "GBP")
            }
            className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Appearance
          </label>
          <select
            value={theme}
            onChange={(e) =>
              setTheme(e.target.value as "dark" | "light" | "aether")
            }
            className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold"
          >
            <option value="dark">Obsidian Dark</option>
            <option value="light">Crystal Daylight</option>
            <option value="aether">Aether Cyber</option>
          </select>
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
            type="button"
            onClick={() => {
              setCustomRpc(activeChainId, rpcInput);
              setStatusMsg("Custom RPC saved.");
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
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
            type="button"
            onClick={handleAutoImportToken}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            Auto-Detect
          </button>
        </div>
      </div>

      {/* Reveal BOTH Recovery Phrase AND Private Key with Password Re-Entry */}
      <form
        onSubmit={handleRevealSecrets}
        className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-indigo-400" />
            <span>Export Recovery Phrase & Private Key</span>
          </div>
          {revealedData && (
            <button
              type="button"
              onClick={() => setRevealedData(null)}
              className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
            >
              <EyeOff className="w-3 h-3" /> Hide Secrets
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="password"
            value={revealPassword}
            onChange={(e) => setRevealPassword(e.target.value)}
            placeholder="Re-enter vault password"
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs"
            required
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
          >
            Decrypt
          </button>
        </div>

        {revealedData && (
          <div className="space-y-3 pt-1">
            {/* 1. 12-Word Secret Recovery Phrase */}
            {revealedData.mnemonic && (
              <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    Secret Recovery Phrase (12 Words)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copySecret(revealedData.mnemonic!, "mnemonic")
                    }
                    className="text-emerald-400 font-semibold flex items-center gap-1"
                  >
                    {copiedType === "mnemonic" ? (
                      <>
                        <Check className="w-3 h-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy Phrase
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs text-slate-200 break-words leading-relaxed select-all">
                  {revealedData.mnemonic}
                </div>
              </div>
            )}

            {/* 2. Hexadecimal Private Key (0x...) */}
            <div className="p-3 rounded-xl bg-slate-950 border border-indigo-500/40 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  Account Private Key (Hex)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copySecret(revealedData.privateKey, "privateKey")
                  }
                  className="text-emerald-400 font-semibold flex items-center gap-1"
                >
                  {copiedType === "privateKey" ? (
                    <>
                      <Check className="w-3 h-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy Key
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-xs text-emerald-300 break-all select-all">
                {revealedData.privateKey}
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Danger Zone: Wipe Wallet */}
      <button
        type="button"
        onClick={() => {
          if (
            window.confirm(
              "Wipe encrypted keystore from this device? Ensure you have backed up your recovery phrase and private key."
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
