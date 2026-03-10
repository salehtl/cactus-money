import { emitDbEvent, onDbEvent } from "./db-events";

describe("db-events", () => {
  it("calls handler when matching event is emitted", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("transactions-changed", handler);

    emitDbEvent("transactions-changed");

    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("does not call handler for different event type", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("transactions-changed", handler);

    emitDbEvent("categories-changed");

    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribes correctly", () => {
    const handler = vi.fn();
    const unsub = onDbEvent("settings-changed", handler);

    emitDbEvent("settings-changed");
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    emitDbEvent("settings-changed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports multiple handlers for same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub1 = onDbEvent("tags-changed", handler1);
    const unsub2 = onDbEvent("tags-changed", handler2);

    emitDbEvent("tags-changed");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});
