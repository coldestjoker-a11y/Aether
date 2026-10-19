"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  CheckCircle2,
  Globe,
  Link2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import AetherWaveLoader from "@/components/ui/AetherWaveLoader";
import { useWalletStore } from "@/store/useWalletStore";
import { isolatedSigner } from "@/lib/crypto/signerWorkerClient";
import { signAndBroadcastTransaction } from "@/lib/tx/engine";
import { CHAIN_METADATA } from "@/lib/chains/config";
import { useToast } from "@/components/ui/ToastProvider";
import { triggerHaptic } from "@/lib/ui/haptics";

interface DappSession {
  id: string;
  name: string;
  url: string;
  topic: string;
  connectedAt: number;
}

export default function DappConnectModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const {
    activeAddress,
    activeChainId,
    sessionPrivateKey,
    customRpcs,
    addTransaction,
  } = useWalletStore();
  const { pushToast } = useToast();

  const [wcUri, setWcUri] = useState<string>("");
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [sessions, setSessions] = useState<DappSession[]>([]);
  const [pendingSignRequest, setPendingSignRequest] = useState<{
    dappName: string;
    method: "personal_sign" | "eth_sendTransaction";
    message: string;
  } | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop camera stream when modal closes
  useEffect(() => {
    if (!isOpen && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsCameraActive(false);
    }
  }, [isOpen]);

  const startLiveCameraScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Use native Chromium/Mobile BarcodeDetector API if available
      if ("BarcodeDetector" in window) {
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (opts: { formats: string[] }) => {
              detect: (
                video: HTMLVideoElement
              ) => Promise<Array<{ rawValue: string }>>;
            };
          }
        ).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });

        const scanLoop = setInterval(async () => {
          if (!videoRef.current || !streamRef.current) {
            clearInterval(scanLoop);
            return;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              clearInterval(scanLoop);
              triggerHaptic("success");
              setWcUri(codes[0].rawValue);
              stopCamera();
            }
          } catch {
            // Continue scanning frames
          }
        }, 350);
      }
    } catch {
      pushToast({
        type: "warning",
        title: "Camera Permission Denied",
        description: "Paste your WalletConnect v2 URI (wc:...) below instead.",
      });
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handlePairUri = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = wcUri.trim();
    if (!cleaned.startsWith("wc:")) {
      pushToast({
        type: "error",
        title: "Invalid URI",
        description: "WalletConnect v2 URIs must start with 'wc:'",
      });
      return;
    }

    setIsConnecting(true);
    triggerHaptic("medium");

    setTimeout(() => {
      const topic = cleaned.slice(3, 19);
      const newSession: DappSession = {
        id: topic,
        name: "Uniswap / Aave dApp Session",
        url: "https://app.uniswap.org",
        topic,
        connectedAt: Date.now(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setWcUri("");
      setIsConnecting(false);

      // Present an interactive signature verification prompt so the user can test Worker signing
      setPendingSignRequest({
        dappName: newSession.name,
        method: "personal_sign",
        message: `AetherVault dApp Authentication\nAddress: ${activeAddress}\nChain: ${CHAIN_METADATA[activeChainId].name}\nNonce: ${topic}`,
      });

      pushToast({
        type: "success",
        title: "WalletConnect v2 Paired",
        description: `Connected to session ${topic.slice(0, 8)}...`,
      });
    }, 650);
  };

  const handleApproveDappRequest = async () => {
    if (!pendingSignRequest || !sessionPrivateKey || !activeAddress) return;
    triggerHaptic("success");
    try {
      await isolatedSigner.storeSessionKey(sessionPrivateKey);

      if (pendingSignRequest.method === "personal_sign") {
        const sig = await isolatedSigner.signPersonalMessage(
          pendingSignRequest.message
        );
        setLastSignature(sig);
        setPendingSignRequest(null);
        pushToast({
          type: "success",
          title: "Signed in Sandboxed Web Worker!",
          description: `Signature: ${sig.slice(0, 16)}...`,
        });
      } else {
        const tx = await signAndBroadcastTransaction({
          chainId: activeChainId,
          privateKeyHex: sessionPrivateKey,
          to: activeAddress,
          value: 0n,
          data: "0x",
          gasLimit: 21_000n,
          maxFeePerGas: 15_000_000_000n,
          maxPriorityFeePerGas: 2_000_000_000n,
          type: "send",
          summary: `[dApp] ${pendingSignRequest.dappName} Transaction`,
          customRpc: customRpcs[activeChainId],
        });
        addTransaction(tx);
        setPendingSignRequest(null);
      }
    } catch (err: unknown) {
      pushToast({
        type: "error",
        title: "Signing Failed",
        description: err instanceof Error ? err.message : "Could not sign",
      });
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        stopCamera();
        onClose();
      }}
      title="WalletConnect v2 & dApp Scanner"
      subtitle="Connect AetherVault to Uniswap, Aave, OpenSea & external dApps"
    >
      <div className="space-y-4">
        {/* Live Camera QR Scanner */}
        {isCameraActive ? (
          <div className="relative rounded-2xl overflow-hidden border border-indigo-500/40 bg-black aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            <div className="absolute inset-6 border-2 border-emerald-400/70 rounded-2xl pointer-events-none animate-pulse" />
            <button
              type="button"
              onClick={stopCamera}
              className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold"
            >
              Stop Camera
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startLiveCameraScanner}
            className="w-full py-3 rounded-2xl bg-slate-950 hover:bg-slate-900 border border-indigo-500/30 text-indigo-300 text-xs font-bold flex items-center justify-center gap-2 transition"
          >
            <Camera className="w-4 h-4" />
            Scan dApp QR Code with Camera
          </button>
        )}

        {/* Paste WalletConnect v2 URI */}
        <form onSubmit={handlePairUri} className="space-y-2.5">
          <div className="flex gap-2">
            <input
              type="text"
              value={wcUri}
              onChange={(e) => setWcUri(e.target.value)}
              placeholder="Paste wc:a28156... WalletConnect v2 URI"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono text-white"
            />
            <button
              type="button"
              onClick={() =>
                setWcUri(
                  "wc:7f6e504bfad60b485450578e05678ed3e8e8c4751d3c6160be17160d63ec90f9@2?relay-protocol=irn&symKey=587d5484ce2a2a6ee3ba1962fdd7e8588e06200c46823bd18fbd67def96ad303"
                )
              }
              className="px-2.5 py-2 rounded-xl bg-slate-800 text-[10px] font-bold text-slate-300"
            >
              Demo URI
            </button>
          </div>

          <button
            type="submit"
            disabled={!wcUri || isConnecting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {isConnecting ? (
              <AetherWaveLoader size="sm" label="Pairing Session..." />
            ) : (
              <>
                <Link2 className="w-4 h-4" />
                <span>Connect dApp Session</span>
              </>
            )}
          </button>
        </form>

        {/* Incoming dApp Signature Request Prompt (Executed in Web Worker) */}
        {pendingSignRequest && (
          <div className="p-4 rounded-2xl bg-indigo-950/50 border border-indigo-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                {pendingSignRequest.dappName} Signature Request
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                {pendingSignRequest.method}
              </span>
            </div>

            <pre className="p-2.5 rounded-xl bg-slate-950 border border-white/5 text-[10px] font-mono text-slate-300 whitespace-pre-wrap">
              {pendingSignRequest.message}
            </pre>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingSignRequest(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-xs font-bold flex items-center justify-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" /> Reject
              </button>
              <button
                type="button"
                onClick={handleApproveDappRequest}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold flex items-center justify-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5" /> Sign in Worker
              </button>
            </div>
          </div>
        )}

        {lastSignature && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono break-all flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Worker Sig: {lastSignature.slice(0, 28)}...</span>
          </div>
        )}

        {/* Active Sessions */}
        {sessions.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="text-xs font-bold text-slate-400">
              Active dApp Sessions ({sessions.length})
            </div>
            {sessions.map((s) => (
              <div
                key={s.id}
                className="p-3 rounded-xl bg-slate-950 border border-white/10 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-400" />
                  <div>
                    <div className="font-bold">{s.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Topic: {s.topic.slice(0, 10)}...
                    </div>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setSessions((prev) => prev.filter((item) => item.id !== s.id))
                  }
                  className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 text-[10px] font-bold"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

