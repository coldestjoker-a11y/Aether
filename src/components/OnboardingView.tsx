"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Eye,
  EyeOff,
  KeyRound,
  Wallet,
  Sparkles,
  Fingerprint,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Lock,
} from "lucide-react";
import {
  generateNewMnemonic,
  deriveAccountFromMnemonic,
  deriveAccountFromPrivateKey,
  isValidMnemonicPhrase,
} from "@/lib/crypto/hdwallet";
import {
  encryptSecretToKeystore,
  decryptKeystoreSecret,
  registerBiometricCredential,
} from "@/lib/crypto/keystore";
import { useWalletStore } from "@/store/useWalletStore";
import { Address } from "viem";

type OnboardingStep =
  | "landing"
  | "create-reveal"
  | "create-quiz"
  | "import-secret"
  | "set-password";

export default function OnboardingView() {
  const {
    keystore,
    isUnlocked,
    setVaultInitialized,
    setExternalConnected,
    unlockWithSessionKey,
    setBiometricCredentialId,
  } = useWalletStore();

  const [step, setStep] = useState<OnboardingStep>("landing");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [isBlurred, setIsBlurred] = useState<boolean>(true);
  const [selectedQuizWords, setSelectedQuizWords] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<"mnemonic" | "privateKey">("mnemonic");
  const [importInput, setImportInput] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [enableBiometrics, setEnableBiometrics] = useState<boolean>(false);
  const [unlockPassword, setUnlockPassword] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const mnemonicWords = useMemo(
    () => (mnemonic ? mnemonic.split(" ") : []),
    [mnemonic]
  );

  // Quiz indices: verify 3 specific positions (e.g., #3, #7, #11)
  const quizTargets = useMemo(() => [2, 6, 10], []);
  const shuffledQuizPool = useMemo(() => {
    if (!mnemonicWords.length) return [];
    return [...mnemonicWords].sort(() => Math.random() - 0.5);
  }, [mnemonicWords]);

  // If keystore exists but is locked, show the Lock Screen
  if (keystore && !isUnlocked) {
    const handleUnlock = async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsLoading(true);
      try {
        const secret = await decryptKeystoreSecret(keystore, unlockPassword);
        const { privateKeyHex } =
          keystore.sourceType === "mnemonic"
            ? deriveAccountFromMnemonic(secret)
            : deriveAccountFromPrivateKey(secret);
        unlockWithSessionKey(privateKeyHex);
        setUnlockPassword("");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to unlock wallet");
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-vault-bg text-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl shadow-2xl"
        >
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold">Welcome Back</h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              {keystore.address.slice(0, 8)}...{keystore.address.slice(-6)}
            </p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Vault Password
              </label>
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-4 py-3 rounded-xl bg-slate-900/90 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
            >
              {isLoading ? "Decrypting Vault (PBKDF2)..." : "Unlock Wallet"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const startCreateWallet = () => {
    const phrase = generateNewMnemonic();
    setMnemonic(phrase);
    setIsBlurred(true);
    setSelectedQuizWords([]);
    setError(null);
    setStep("create-reveal");
  };

  const handleQuizWordClick = (word: string) => {
    if (selectedQuizWords.length >= 3) return;
    setSelectedQuizWords((prev) => [...prev, word]);
  };

  const verifyQuizAndProceed = () => {
    const expected = quizTargets.map((idx) => mnemonicWords[idx]);
    const isCorrect =
      selectedQuizWords.length === 3 &&
      selectedQuizWords.every((w, i) => w === expected[i]);

    if (!isCorrect) {
      setError("Word order does not match your recovery phrase. Please try again.");
      setSelectedQuizWords([]);
      return;
    }
    setError(null);
    setStep("set-password");
  };

  const validateImportAndProceed = () => {
    setError(null);
    try {
      if (importMode === "mnemonic") {
        if (!isValidMnemonicPhrase(importInput)) {
          throw new Error("Invalid 12/24-word BIP-39 recovery phrase.");
        }
      } else {
        deriveAccountFromPrivateKey(importInput);
      }
      setStep("set-password");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid secret");
    }
  };

  const finalizeVaultCreation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const isMnemonicFlow = mnemonic.length > 0 || importMode === "mnemonic";
      const rawSecret = mnemonic.length > 0 ? mnemonic : importInput.trim();

      const { account, privateKeyHex } = isMnemonicFlow
        ? deriveAccountFromMnemonic(rawSecret)
        : deriveAccountFromPrivateKey(rawSecret);

      const encrypted = await encryptSecretToKeystore(
        rawSecret,
        password,
        account.address,
        isMnemonicFlow ? "mnemonic" : "privateKey"
      );

      if (enableBiometrics) {
        const credId = await registerBiometricCredential(account.address);
        setBiometricCredentialId(credId);
      }

      // Clear transient state before initializing unlocked store
      setMnemonic("");
      setImportInput("");
      setPassword("");
      setConfirmPassword("");

      setVaultInitialized(encrypted, privateKeyHex);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Encryption failed");
    } finally {
      setIsLoading(false);
    }
  };

  const connectInjectedOrWC = async () => {
    setError(null);
    try {
      const eth = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
      if (eth) {
        const accounts = await eth.request({ method: "eth_requestAccounts" });
        if (accounts && accounts[0]) {
          setExternalConnected(accounts[0] as Address);
          return;
        }
      }
      setError(
        "No injected wallet detected. Use Create or Import Wallet to test full non-custodial signing immediately."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection rejected");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-vault-bg text-white">
      <div className="w-full max-w-md">
        <AnimatePresence mode="wait">
          {step === "landing" && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl shadow-2xl space-y-6"
            >
              <div className="text-center space-y-2 pt-2">
                <div className="inline-flex p-4 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/30 mb-2">
                  <ShieldCheck className="w-12 h-12 text-indigo-400" />
                </div>
                <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-emerald-300 bg-clip-text text-transparent">
                  AetherVault
                </h1>
                <p className="text-sm text-slate-400">
                  Self-custodial multi-chain DeFi wallet with real-time tx simulation & GoPlus threat defense.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  data-testid="btn-create-wallet"
                  onClick={startCreateWallet}
                  className="w-full p-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 font-semibold flex items-center justify-between transition shadow-lg shadow-indigo-600/20"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5" />
                    <div className="text-left">
                      <div className="text-sm font-bold">Create New Wallet</div>
                      <div className="text-xs text-indigo-200">
                        Generate 12-word BIP39 phrase
                      </div>
                    </div>
                  </div>
                  <span>→</span>
                </button>

                <button
                  data-testid="btn-import-wallet"
                  onClick={() => {
                    setMnemonic("");
                    setError(null);
                    setStep("import-secret");
                  }}
                  className="w-full p-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 font-semibold flex items-center justify-between transition"
                >
                  <div className="flex items-center gap-3">
                    <KeyRound className="w-5 h-5 text-emerald-400" />
                    <div className="text-left">
                      <div className="text-sm font-bold">Import Existing Wallet</div>
                      <div className="text-xs text-slate-400">
                        Seed phrase or raw private key
                      </div>
                    </div>
                  </div>
                  <span>→</span>
                </button>

                <button
                  onClick={connectInjectedOrWC}
                  className="w-full p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 font-semibold flex items-center justify-between transition"
                >
                  <div className="flex items-center gap-3">
                    <Wallet className="w-5 h-5 text-amber-400" />
                    <div className="text-left">
                      <div className="text-sm font-bold">Connect Existing Wallet</div>
                      <div className="text-xs text-slate-400">
                        Browser Extension / WalletConnect v2
                      </div>
                    </div>
                  </div>
                  <span>→</span>
                </button>
              </div>

              {error && (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl">
                  {error}
                </p>
              )}
            </motion.div>
          )}

          {step === "create-reveal" && (
            <motion.div
              key="create-reveal"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl space-y-5"
            >
              <button
                onClick={() => setStep("landing")}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div>
                <h2 className="text-xl font-bold">Secret Recovery Phrase</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Write down these 12 words in exact order. We never transmit or store this phrase in plaintext.
                </p>
              </div>

              <div className="relative">
                <div
                  data-testid="mnemonic-grid"
                  className={`grid grid-cols-3 gap-2.5 p-4 rounded-2xl bg-slate-950/90 border border-slate-800 transition duration-300 ${
                    isBlurred ? "blur-md select-none" : ""
                  }`}
                >
                  {mnemonicWords.map((word, index) => (
                    <div
                      key={index}
                      data-testid={`mnemonic-word-${index}`}
                      className="px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800/80 text-xs font-mono flex items-center gap-1.5"
                    >
                      <span className="text-slate-500">{index + 1}.</span>
                      <span className="text-white font-semibold">{word}</span>
                    </div>
                  ))}
                </div>

                {isBlurred && (
                  <button
                    data-testid="btn-reveal-phrase"
                    onClick={() => setIsBlurred(false)}
                    className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-2xl text-sm font-semibold gap-2"
                  >
                    <Eye className="w-6 h-6 text-indigo-400" />
                    <span>Tap to Reveal Recovery Phrase</span>
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setIsBlurred((b) => !b)}
                  className="text-xs text-slate-400 flex items-center gap-1 hover:text-white"
                >
                  {isBlurred ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {isBlurred ? "Show Phrase" : "Hide Phrase"}
                </button>
              </div>

              <button
                data-testid="btn-proceed-quiz"
                disabled={isBlurred}
                onClick={() => setStep("create-quiz")}
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-semibold text-sm transition"
              >
                I Have Saved My Phrase → Verify
              </button>
            </motion.div>
          )}

          {step === "create-quiz" && (
            <motion.div
              key="create-quiz"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl space-y-5"
            >
              <button
                onClick={() => setStep("create-reveal")}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Phrase
              </button>

              <div>
                <h2 className="text-xl font-bold">Confirm Recovery Phrase</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Select words{" "}
                  <span className="text-indigo-400 font-bold">
                    #{quizTargets[0] + 1}, #{quizTargets[1] + 1}, and #{quizTargets[2] + 1}
                  </span>{" "}
                  in order to verify your backup.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-slate-950 border border-slate-800">
                {quizTargets.map((targetIdx, slot) => (
                  <div
                    key={targetIdx}
                    className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-center"
                  >
                    <div className="text-[10px] text-slate-500">Word #{targetIdx + 1}</div>
                    <div className="font-bold text-indigo-300 mt-0.5">
                      {selectedQuizWords[slot] || "—"}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {shuffledQuizPool.map((word, idx) => (
                  <button
                    key={`${word}-${idx}`}
                    data-testid={`quiz-option-${word}`}
                    onClick={() => handleQuizWordClick(word)}
                    className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-indigo-600/30 border border-slate-800 text-xs font-mono transition"
                  >
                    {word}
                  </button>
                ))}
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedQuizWords([])}
                  className="px-4 py-3 rounded-xl bg-slate-800 text-xs font-semibold"
                >
                  Reset
                </button>
                <button
                  data-testid="btn-verify-quiz"
                  disabled={selectedQuizWords.length < 3}
                  onClick={verifyQuizAndProceed}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-semibold text-sm transition"
                >
                  Confirm Backup
                </button>
              </div>
            </motion.div>
          )}

          {step === "import-secret" && (
            <motion.div
              key="import-secret"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl space-y-5"
            >
              <button
                onClick={() => setStep("landing")}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div>
                <h2 className="text-xl font-bold">Import Wallet</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Enter your 12-word recovery phrase or 64-character hex private key.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
                <button
                  onClick={() => setImportMode("mnemonic")}
                  className={`py-2 rounded-lg text-xs font-semibold transition ${
                    importMode === "mnemonic"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-400"
                  }`}
                >
                  Seed Phrase
                </button>
                <button
                  onClick={() => setImportMode("privateKey")}
                  className={`py-2 rounded-lg text-xs font-semibold transition ${
                    importMode === "privateKey"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-400"
                  }`}
                >
                  Private Key
                </button>
              </div>

              <textarea
                data-testid="input-import-secret"
                rows={3}
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder={
                  importMode === "mnemonic"
                    ? "word1 word2 word3 ... word12"
                    : "0x..."
                }
                className="w-full p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono focus:outline-none focus:border-indigo-500"
              />

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                data-testid="btn-continue-import"
                onClick={validateImportAndProceed}
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition"
              >
                Continue to Encryption
              </button>
            </motion.div>
          )}

          {step === "set-password" && (
            <motion.form
              key="set-password"
              onSubmit={finalizeVaultCreation}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="p-6 rounded-3xl bg-vault-card border border-vault-border backdrop-blur-xl space-y-4"
            >
              <div>
                <h2 className="text-xl font-bold">Encrypt Your Keystore</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Protected with WebCrypto PBKDF2 (310,000 iterations) + AES-256-GCM.
                </p>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  New Vault Password (min 8 chars)
                </label>
                <input
                  data-testid="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Confirm Vault Password
                </label>
                <input
                  data-testid="input-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                  required
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Fingerprint className="w-5 h-5 text-emerald-400" />
                  <div>
                    <div className="text-xs font-semibold">Biometric / Passkey Unlock</div>
                    <div className="text-[11px] text-slate-400">
                      Bind device WebAuthn authenticator
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enableBiometrics}
                  onChange={(e) => setEnableBiometrics(e.target.checked)}
                  className="accent-indigo-500 w-4 h-4"
                />
              </label>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                data-testid="btn-complete-onboarding"
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 font-semibold text-sm flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isLoading ? "Encrypting Keystore..." : "Encrypt & Launch Wallet"}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * STAGE 2 VERIFICATION CHECKLIST:
 * 1. Click "Create New Wallet", verify 12 BIP-39 words are blurred until "Tap to Reveal" is clicked.
 * 2. Complete the 3-word confirmation quiz and set an 8+ character password.
 * 3. Open DevTools -> Application -> Local Storage (`aethervault-storage-v1`) and verify:
 *    - `keystore.ciphertext`, `keystore.salt`, and `keystore.iv` are Base64 encoded.
 *    - NO plaintext mnemonic or `sessionPrivateKey` exists anywhere in LocalStorage or console logs.
 */
