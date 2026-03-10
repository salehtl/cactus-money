import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";
import { ToastProvider } from "../components/ui/Toast";
import { vi } from "vitest";

/**
 * A mock DbClient matching the exec() interface used by useDb().
 * By default all queries resolve with empty results.
 * Override exec in individual tests: mockDb.exec.mockResolvedValueOnce(...)
 */
export const mockDb = {
  exec: vi.fn().mockResolvedValue({ rows: [], changes: 0 }),
  waitReady: vi.fn().mockResolvedValue("memory"),
  storageType: "memory" as string,
};

/**
 * Reset mockDb to default behavior between tests.
 */
export function resetMockDb() {
  mockDb.exec.mockReset().mockResolvedValue({ rows: [], changes: 0 });
  mockDb.waitReady.mockReset().mockResolvedValue("memory");
  mockDb.storageType = "memory";
}

/**
 * Convenience: call vi.mock on DbContext so useDb() returns mockDb.
 * Must be called at the top level of a test file (hoisted by Vitest).
 *
 * Usage at top of test file:
 *   vi.mock("@/context/DbContext", () => ({
 *     useDb: () => mockDb,
 *     DbProvider: ({ children }: { children: ReactNode }) => children,
 *   }));
 */

function AllProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

/**
 * Render a component wrapped in the providers most tests need (ToastProvider).
 *
 * For components that call useDb(), mock the module at the top of your test file:
 *   vi.mock("@/context/DbContext", () => ({
 *     useDb: () => mockDb,
 *     DbProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
 *   }));
 *
 * @param ui - React element to render
 * @param options - Standard @testing-library/react RenderOptions
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}
