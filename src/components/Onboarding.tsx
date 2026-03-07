import { useState, useEffect, useRef } from "react";
import { useDb } from "../context/DbContext.tsx";
import { useTheme } from "../hooks/useTheme.ts";
import { Button } from "./ui/Button.tsx";
import { getSetting, setSetting } from "../db/queries/settings.ts";

const STEPS = [
  {
    key: "welcome",
    title: "Welcome to Cactus Money",
    subtitle: "Personal finance that stays personal.",
    items: [
      "Track your money without accounts, subscriptions, or cloud sync",
      "Everything runs locally in your browser — fast, private, yours",
      "Built for simplicity: add transactions, see your cashflow, stay sharp",
    ],
  },
  {
    key: "features",
    title: "How it works",
    subtitle: "Three ways to stay on top of your finances.",
    items: [
      ["Cashflow tracking", "Add income and expenses month by month with inline editing"],
      ["PDF import", "Drop a bank statement — AI reads it and imports your transactions"],
      ["Recurring transactions", "Set up bills and income that auto-populate each period"],
    ],
    icon: FeaturesIcon,
  },
  {
    key: "data",
    title: "Your data, your device",
    subtitle: "No servers. No telemetry. Just your browser.",
    items: [
      "All data is stored locally using your browser's built-in storage",
      "On Chrome or Edge: enable auto-export to back up to iCloud, Dropbox, or any folder",
      "On other browsers: use manual JSON export in Settings to save backups",
    ],
    icon: DataIcon,
  },
  {
    key: "tips",
    title: "A few tips",
    subtitle: "Get the most out of the app.",
    items: [
      ["Install as an app", "Look for the install icon in your browser's address bar"],
      ["Best on Chromium", "Chrome, Edge, and Arc support all features including auto-export"],
      ["Currency: AED", "All amounts are in UAE Dirham — this is baked into the app"],
    ],
    icon: TipsIcon,
  },
] as const;

// null = loading, false = already completed, true = show onboarding
type OnboardingState = null | false | true;

export function Onboarding() {
  const db = useDb();
  const { isDark } = useTheme();
  const [state, setState] = useState<OnboardingState>(null);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    getSetting(db, "onboarding_complete").then((v) => {
      if (!active) return;
      setState(v !== "true");
    });
    return () => { active = false; };
  }, [db]);

  useEffect(() => {
    if (state === true && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [state]);

  if (state !== true) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const Icon = "icon" in current ? current.icon : null;
  const logoSrc = isDark
    ? "/meta-media/logo-square-darkmode.svg"
    : "/meta-media/logo-square-lightmode.svg";

  async function handleDismiss() {
    await setSetting(db, "onboarding_complete", "true");
    dialogRef.current?.close();
    setState(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/50 bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full fixed inset-0 outline-none"
    >
      <div className="flex items-center justify-center min-h-full p-4">
        <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-border">
          {/* Header area with icon */}
          <div className="relative bg-surface-alt px-6 pt-8 pb-6 border-b border-border">
            {/* Skip button */}
            {!isLast && (
              <button
                type="button"
                onClick={handleDismiss}
                className="absolute top-4 right-4 text-[11px] text-text-light hover:text-text-muted transition-colors cursor-pointer"
              >
                Skip
              </button>
            )}

            {/* Step icon + logo on first step */}
            <div className="flex flex-col items-center">
              {Icon ? (
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 text-accent">
                  <Icon />
                </div>
              ) : (
                <img src={logoSrc} alt="" className="w-14 h-14 mb-4" />
              )}
              <h2 className="text-lg font-bold text-center">{current.title}</h2>
              <p className="text-xs text-text-muted text-center mt-1">{current.subtitle}</p>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5">
            <ul className="space-y-3">
              {current.items.map((item, i) => {
                const isCompound = Array.isArray(item);
                return (
                  <li
                    key={i}
                    className="flex gap-3 items-start animate-slide-up"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-[7px]" />
                    <div className="min-w-0">
                      {isCompound ? (
                        <>
                          <p className="text-sm font-medium">{item[0]}</p>
                          <p className="text-xs text-text-muted mt-0.5">{item[1]}</p>
                        </>
                      ) : (
                        <p className="text-sm text-text-muted">{item}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Footer: dots + buttons */}
          <div className="px-6 pb-5 flex items-center justify-between">
            {/* Dots */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`rounded-full transition-all cursor-pointer ${
                    i === step
                      ? "w-5 h-1.5 bg-accent"
                      : "w-1.5 h-1.5 bg-border-dark hover:bg-text-light"
                  }`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
                  Back
                </Button>
              )}
              {isLast ? (
                <Button size="sm" onClick={handleDismiss}>
                  Get started
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                  Next
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

// --- Step Icons ---

function FeaturesIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function DataIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function TipsIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}
