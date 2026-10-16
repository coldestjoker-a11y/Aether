"use client";

import React, { useState } from "react";
import {
  ShieldOff,
  Eye,
  Trash2,
  Lock,
  PlusCircle,
  Server,
} from "lucide-react";
import { Address } from "viem";
import { useWalletStore } from "@/store/useWalletStore";
import { decryptKeystoreSecret } from "@/lib/crypto/keystore";
import {
  encodeErc20Approve,
  simulateAndEstimateTransaction,
  signAndBroadcastTransaction,
} from "@/lib/tx/engine";
import { CHAIN_METADATA } from "@/lib/chains/config";

export default function SettingsView() {
  const {
    keystore,
    activeAddress,
    activeChainId,
    sessionPrivateKey,
    customRpcs,
    setCustomRpc,
    addCustomToken,
    currency,
    setCurrency,
    theme,
    setTheme,
    lockWallet,
    resetWallet,
    addTransaction,
  } = useWalletStore();

  const [rpcInput, setRpcInput] = useState<string>(
    customRpcs[activeChainId] || ""
  );
  const [tokenAddr, setTokenAddr] = useState<string>("");
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  const [revokeTokenAddr, setRevokeTokenAddr] = useState<string>(
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  );
  const [revokeSpender, setRevokeSpender] = useState<string>(
    "0xDef1C0ded9bec7F1a1670819833240f027b25EfF"
  );

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

  const handleRevokeAllowance = async () => {
    if (!sessionPrivateKey || !activeAddress) return;
    try {
      const data = encodeErc20Approve(revokeSpender as Address, 0n);
      const sim = await simulateAndEstimateTransaction({
        chainId: activeChainId,
        from: activeAddress,
        to: revokeTokenAddr as Address,
        data,
      });

      const tx = await signAndBroadcastTransaction({
        chainId: activeChainId,
        privateKeyHex: sessionPrivateKey,
        to: revokeTokenAddr as Address,
        value: 0n,
        data,
        gasLimit: sim.fees.estimatedGasLimit,
        maxFeePerGas: sim.fees.normal.maxFeePerGas,
        maxPriorityFeePerGas: sim.fees.normal.maxPriorityFeePerGas,
        type: "approve",
        summary: `Revoke Allowance on ${revokeTokenAddr.slice(0, 8)}...`,
      });
      addTransaction(tx);
      setStatusMsg(`Revoke transaction broadcasted: ${tx.hash.slice(0, 12)}...`);
    } catch (err: unknown) {
      setStatusMsg(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Security & Settings</h2>
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

      {/* Currency & Theme */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Display Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "USD" | "EUR" | "GBP")}
            className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Appearance</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "dark" | "light")}
            className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold"
          >
            <option value="dark">Obsidian Dark</option>
            <option value="light">Daylight</option>
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

      {/* Add Custom ERC-20 Token */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5">
        <div className="text-xs font-bold flex items-center gap-1.5">
          <PlusCircle className="w-4 h-4 text-emerald-400" />
          <span>Import Custom Token</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="0x Contract..."
            value={tokenAddr}
            onChange={(e) => setTokenAddr(e.target.value)}
            className="col-span-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
          />
          <input
            type="text"
            placeholder="Symbol"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs"
          />
        </div>
        <button
          onClick={() => {
            if (!tokenAddr || !tokenSymbol) return;
            addCustomToken({
              chainId: activeChainId,
              address: tokenAddr as Address,
              symbol: tokenSymbol.toUpperCase(),
              name: tokenSymbol.toUpperCase(),
              decimals: 18,
              isCustom: true,
            });
            setTokenAddr("");
            setTokenSymbol("");
            setStatusMsg("Custom token added to active chain.");
          }}
          className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
        >
          Add Token
        </button>
      </div>

      {/* ERC-20 Approval Revoker */}
      <div className="p-4 rounded-2xl bg-vault-card border border-vault-border space-y-2.5">
        <div className="text-xs font-bold flex items-center gap-1.5 text-amber-300">
          <ShieldOff className="w-4 h-4" />
          <span>Token Approvals Manager (Revoke Spender)</span>
        </div>
        <input
          type="text"
          value={revokeTokenAddr}
          onChange={(e) => setRevokeTokenAddr(e.target.value)}
          placeholder="Token Contract (0x...)"
          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
        />
        <input
          type="text"
          value={revokeSpender}
          onChange={(e) => setRevokeSpender(e.target.value)}
          placeholder="Spender Router (0x...)"
          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono"
        />
        <button
          onClick={handleRevokeAllowance}
          className="w-full py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold"
        >
          Revoke Allowance (Set to 0)
        </button>
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
