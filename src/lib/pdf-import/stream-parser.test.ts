import { describe, it, expect, vi } from "vitest";
import { extractStreamedObjects } from "./stream-parser";

describe("extractStreamedObjects", () => {
  it("extracts a single complete object from a JSON array", () => {
    const text = '[{"name":"Alice","age":30}]';
    const onObject = vi.fn();
    const offset = extractStreamedObjects(text, 0, onObject);
    expect(onObject).toHaveBeenCalledTimes(1);
    expect(onObject).toHaveBeenCalledWith({ name: "Alice", age: 30 });
    expect(offset).toBeGreaterThan(0);
  });

  it("extracts multiple objects", () => {
    const text = '[{"a":1},{"b":2},{"c":3}]';
    const onObject = vi.fn();
    extractStreamedObjects(text, 0, onObject);
    expect(onObject).toHaveBeenCalledTimes(3);
    expect(onObject).toHaveBeenNthCalledWith(1, { a: 1 });
    expect(onObject).toHaveBeenNthCalledWith(2, { b: 2 });
    expect(onObject).toHaveBeenNthCalledWith(3, { c: 3 });
  });

  it("returns 0 when no opening bracket found", () => {
    const text = "no array here";
    const onObject = vi.fn();
    const offset = extractStreamedObjects(text, 0, onObject);
    expect(offset).toBe(0);
    expect(onObject).not.toHaveBeenCalled();
  });

  it("stops at incomplete object and returns offset for resumption", () => {
    const text = '[{"a":1},{"b":2';
    const onObject = vi.fn();
    const offset = extractStreamedObjects(text, 0, onObject);
    expect(onObject).toHaveBeenCalledTimes(1);
    expect(onObject).toHaveBeenCalledWith({ a: 1 });
    // offset should point to the start of the incomplete object
    expect(offset).toBeLessThan(text.length);
  });

  it("resumes from a previous offset", () => {
    const chunk1 = '[{"a":1},{"b":2';
    const onObject1 = vi.fn();
    const offset1 = extractStreamedObjects(chunk1, 0, onObject1);
    expect(onObject1).toHaveBeenCalledTimes(1);

    // Simulate more data arriving
    const chunk2 = chunk1 + "}]";
    const onObject2 = vi.fn();
    const offset2 = extractStreamedObjects(chunk2, offset1, onObject2);
    expect(onObject2).toHaveBeenCalledTimes(1);
    expect(onObject2).toHaveBeenCalledWith({ b: 2 });
    expect(offset2).toBeGreaterThan(offset1);
  });

  it("handles nested braces inside strings", () => {
    const text = '[{"data":"value with {braces} inside"}]';
    const onObject = vi.fn();
    extractStreamedObjects(text, 0, onObject);
    expect(onObject).toHaveBeenCalledTimes(1);
    expect(onObject).toHaveBeenCalledWith({
      data: "value with {braces} inside",
    });
  });

  it("handles escaped quotes in strings", () => {
    const text = '[{"msg":"he said \\"hello\\""}]';
    const onObject = vi.fn();
    extractStreamedObjects(text, 0, onObject);
    expect(onObject).toHaveBeenCalledTimes(1);
    expect(onObject).toHaveBeenCalledWith({ msg: 'he said "hello"' });
  });

  it("skips malformed objects gracefully", () => {
    // Construct text where brace tracking finds a "complete" object but JSON.parse fails
    const text = '[{bad json},{"a":1}]';
    const onObject = vi.fn();
    extractStreamedObjects(text, 0, onObject);
    // The malformed object is skipped, the valid one is emitted
    expect(onObject).toHaveBeenCalledTimes(1);
    expect(onObject).toHaveBeenCalledWith({ a: 1 });
  });

  it("handles empty array", () => {
    const text = "[]";
    const onObject = vi.fn();
    const offset = extractStreamedObjects(text, 0, onObject);
    expect(onObject).not.toHaveBeenCalled();
    expect(offset).toBeGreaterThan(0);
  });
});
