import { describe, test, expect } from "@jest/globals";

/**
 * Security Property:
 * Memory allocation size calculations based on nfft parameters must never
 * overflow, and adversarial nfft values must be rejected or safely handled
 * before any allocation or processing occurs.
 *
 * This guards against integer overflow in allocation size calculations
 * (e.g., sizeof(kiss_fft_cpx) * nfft) that could result in undersized
 * allocations followed by heap buffer overflows.
 */

// Simulate the allocation size calculation as it would occur in the FFT library
// sizeof(kiss_fft_cpx) is typically 8 bytes (two 32-bit floats: real + imaginary)
const KISS_FFT_CPX_SIZE = 8; // bytes per complex sample
const MAX_SAFE_ALLOCATION = 2 * 1024 * 1024 * 1024; // 2GB practical upper bound
const MAX_SAFE_NFFT = Math.floor(MAX_SAFE_ALLOCATION / KISS_FFT_CPX_SIZE);

// Simulate what a safe FFT initialization function should do
function safeKissFftInit(nfft: number): {
  success: boolean;
  allocationSize: number | null;
  error?: string;
} {
  // Validate nfft is a positive integer
  if (!Number.isInteger(nfft) || nfft <= 0) {
    return { success: false, allocationSize: null, error: "Invalid nfft: must be a positive integer" };
  }

  // Check for values that would cause integer overflow in C
  // In C: sizeof(kiss_fft_cpx) * nfft must not overflow size_t
  // MAX_UINT32 = 4294967295, MAX_UINT64 is much larger but we guard conservatively
  const MAX_UINT32 = 4294967295;
  if (nfft > MAX_UINT32) {
    return { success: false, allocationSize: null, error: "nfft exceeds maximum safe value (uint32 overflow risk)" };
  }

  // Check that the multiplication itself doesn't overflow JavaScript's safe integer range
  // and stays within practical allocation limits
  const allocationSize = KISS_FFT_CPX_SIZE * nfft;

  if (!Number.isSafeInteger(allocationSize)) {
    return { success: false, allocationSize: null, error: "Allocation size calculation overflows safe integer range" };
  }

  if (allocationSize > MAX_SAFE_ALLOCATION) {
    return { success: false, allocationSize: null, error: "Allocation size exceeds maximum safe allocation limit" };
  }

  if (allocationSize <= 0) {
    return { success: false, allocationSize: null, error: "Allocation size is non-positive after calculation" };
  }

  return { success: true, allocationSize };
}

// Parse nfft from audio metadata (simulating what the vulnerable code path does)
function parseNfftFromMetadata(rawValue: unknown): number {
  if (typeof rawValue === "string") {
    const parsed = parseInt(rawValue, 10);
    if (isNaN(parsed)) {
      return -1;
    }
    return parsed;
  }
  if (typeof rawValue === "number") {
    return Math.trunc(rawValue);
  }
  return -1;
}

describe("FFT nfft parameter must never cause integer overflow in allocation size calculation", () => {
  const adversarialPayloads: Array<[string, unknown, string]> = [
    // [description, rawInput, expectedBehavior]
    ["MAX_UINT32 (4294967295)", 4294967295, "reject"],
    ["MAX_UINT32 + 1 (4294967296)", 4294967296, "reject"],
    ["MAX_UINT32 * 2", 4294967295 * 2, "reject"],
    ["Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER, "reject"],
    ["Number.MAX_VALUE", Number.MAX_VALUE, "reject"],
    ["Infinity", Infinity, "reject"],
    ["-Infinity", -Infinity, "reject"],
    ["NaN", NaN, "reject"],
    ["zero", 0, "reject"],
    ["negative one", -1, "reject"],
    ["very large string number", "99999999999999999999999999999", "reject"],
    ["string MAX_UINT32", "4294967295", "reject"],
    ["string overflow value", "9999999999999999999", "reject"],
    ["float that truncates to overflow", 4294967295.9, "reject"],
    ["negative large", -4294967295, "reject"],
    ["allocation overflow boundary: nfft causing size > 2GB", Math.floor(MAX_SAFE_ALLOCATION / KISS_FFT_CPX_SIZE) + 1, "reject"],
    ["exact overflow boundary", MAX_SAFE_NFFT + 1, "reject"],
    ["2^31 (signed int overflow)", Math.pow(2, 31), "reject"],
    ["2^32 (unsigned int overflow)", Math.pow(2, 32), "reject"],
    ["2^53 (JS safe integer boundary)", Math.pow(2, 53), "reject"],
    ["string with embedded null", "1024\x00malicious", "reject"],
    ["string with format specifier", "%s%s%s%s%s", "reject"],
    ["object injection", { valueOf: () => Number.MAX_VALUE }, "reject"],
    ["array injection", [4294967295], "reject"],
    ["null", null, "reject"],
    ["undefined", undefined, "reject"],
  ];

  const validPayloads: Array<[string, unknown, string]> = [
    ["small valid nfft: 512", 512, "accept"],
    ["valid nfft: 1024", 1024, "accept"],
    ["valid nfft: 2048", 2048, "accept"],
    ["valid nfft: 4096", 4096, "accept"],
    ["valid nfft: 8192", 8192, "accept"],
  ];

  test.each(adversarialPayloads)(
    "rejects adversarial input: %s",
    (description, rawInput, _expectedBehavior) => {
      const nfft = parseNfftFromMetadata(rawInput);
      const result = safeKissFftInit(nfft);

      // INVARIANT: Adversarial inputs must never succeed
      expect(result.success).toBe(false);

      // INVARIANT: No allocation size should be returned for rejected inputs
      expect(result.allocationSize).toBeNull();

      // INVARIANT: An error message must be provided
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
    }
  );

  test.each(validPayloads)(
    "accepts valid input: %s",
    (description, rawInput, _expectedBehavior) => {
      const nfft = parseNfftFromMetadata(rawInput);
      const result = safeKissFftInit(nfft);

      // INVARIANT: Valid inputs should succeed
      expect(result.success).toBe(true);

      // INVARIANT: Allocation size must be a safe, positive integer
      expect(result.allocationSize).not.toBeNull();
      expect(Number.isSafeInteger(result.allocationSize!)).toBe(true);
      expect(result.allocationSize!).toBeGreaterThan(0);
      expect(result.allocationSize!).toBeLessThanOrEqual(MAX_SAFE_ALLOCATION);
    }
  );

  test("allocation size calculation never overflows for any nfft up to safe boundary", () => {
    // Property: for all nfft in [1, MAX_SAFE_NFFT], the allocation size must be
    // a safe integer and within bounds
    const testPoints = [1, 2, 512, 1024, 4096, 65536, 1048576, MAX_SAFE_NFFT];

    for (const nfft of testPoints) {
      const result = safeKissFftInit(nfft);
      expect(result.success).toBe(true);
      expect(result.allocationSize).not.toBeNull();
      expect(Number.isSafeInteger(result.allocationSize!)).toBe(true);
      expect(result.allocationSize!).toBe(KISS_FFT_CPX_SIZE * nfft);
      expect(result.allocationSize!).toBeLessThanOrEqual(MAX_SAFE_ALLOCATION);
    }
  });

  test("allocation size calculation always overflows or is rejected beyond safe boundary", () => {
    // Property: for all nfft > MAX_SAFE_NFFT, the request must be rejected
    const overflowPoints = [
      MAX_SAFE_NFFT + 1,
      MAX_SAFE_NFFT + 1000,
      MAX_SAFE_NFFT * 2,
      4294967295,
    ];

    for (const nfft of overflowPoints) {
      const result = safeKissFftInit(nfft);
      // INVARIANT: Must be rejected — no successful allocation for overflow values
      expect(result.success).toBe(false);
      expect(result.allocationSize).toBeNull();
    }
  });

  test("nfft derived from audio metadata must be validated before allocation", () => {
    // Simulate adversarial audio file metadata with crafted nfft values
    const maliciousAudioMetadata = [
      { nfft: "4294967295", description: "MAX_UINT32 in metadata" },
      { nfft: "536870912", description: "512MB worth of complex samples" },
      { nfft: "-1", description: "negative value in metadata" },
      { nfft: "0", description: "zero in metadata" },
      { nfft: "99999999999", description: "extremely large value in metadata" },
    ];

    for (const metadata of maliciousAudioMetadata) {
      const nfft = parseNfftFromMetadata(metadata.nfft);
      const result = safeKissFftInit(nfft);

      // INVARIANT: Metadata-derived nfft values that could cause overflow must be rejected
      if (nfft <= 0 || nfft > MAX_SAFE_NFFT) {
        expect(result.success).toBe(false);
        expect(result.allocationSize).toBeNull();
        expect(result.error).toBeDefined();
      }
    }
  });

  test("integer overflow in size calculation is always detected", () => {
    // Directly test the overflow detection logic
    // In C: sizeof(kiss_fft_cpx) * nfft where sizeof = 8
    // If nfft = 0x20000000 (536870912), size = 4GB which overflows uint32

    const overflowNfft = 536870912; // 2^29, causes 4GB allocation with 8-byte elements
    const calculatedSize = KISS_FFT_CPX_SIZE * overflowNfft;

    // INVARIANT: The calculated size must exceed our safety limit
    expect(calculatedSize).toBeGreaterThan(MAX_SAFE_ALLOCATION);

    const result = safeKissFftInit(overflowNfft);
    expect(result.success).toBe(false);
    expect(result.allocationSize).toBeNull();
  });
});