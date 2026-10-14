import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const scan = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    extra: Record<string, unknown>;
    constructor(status: number, message: string, code?: string, extra = {}) {
      super(message);
      this.status = status;
      this.code = code;
      this.extra = extra;
    }
  }
  return {
    ApiError,
    uploadReceipt: (...a: unknown[]) => upload(...a),
    getScan: (id: string) => scan(id),
  };
});
const quality = vi.fn();
vi.mock("@/lib/scanQuality", async (orig) => ({
  ...(await orig<typeof import("./scanQuality")>()),
  checkPhoto: (f: Blob) => quality(f),
}));
vi.mock("@/lib/upload", () => ({
  UPLOADED_EVENT: "rw:uploaded",
  compressImage: async () => new Blob(["small"], { type: "image/webp" }),
}));

import { ApiError } from "@/lib/api";

import { addFiles, getItems, MAX_BATCH, resetQueue, retry, sendAnyway, typeOf } from "./scanQueue";

const photo = (name = "r.jpg") => new File(["x"], name, { type: "image/jpeg" });
const settle = () => new Promise((r) => setTimeout(r, 0));
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 50 && !fn(); i++) await settle();
};
const ok = (merchant = "Corner Market") => ({ id: "r1", status: "extracted", merchant });

beforeEach(() => {
  resetQueue();
  upload.mockReset();
  scan.mockReset();
  quality.mockReset().mockResolvedValue({ issue: null });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => resetQueue());

describe("scan queue", () => {
  it("adds a good photo to the tab and tells the app", async () => {
    const heard = vi.fn();
    window.addEventListener("rw:uploaded", heard);
    upload.mockResolvedValue(ok());
    addFiles([photo()]);
    await until(() => getItems()[0].status === "added");
    expect(getItems()[0].title).toBe("Corner Market is on your tab");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("rw:uploaded", heard);
  });

  it("holds a blurry photo until the person decides", async () => {
    quality.mockResolvedValue({ issue: "blurry" });
    upload.mockResolvedValue(ok());
    addFiles([photo()]);
    await until(() => getItems()[0].status === "needs_ok");
    expect(getItems()[0].title).toBe("This photo looks blurry");
    expect(upload).not.toHaveBeenCalled();
    sendAnyway(getItems()[0].id);
    await until(() => getItems()[0].status === "added");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when it isn't a receipt", async () => {
    upload.mockRejectedValue(
      new ApiError(422, "That doesn't look like a receipt, so nothing was added.", "not_a_receipt")
    );
    addFiles([photo()]);
    await until(() => getItems()[0].status === "refused");
    expect(getItems()[0].title).toBe("Not a receipt");
    expect(getItems()[0].message).toContain("nothing was added");
  });

  it("points to the existing receipt for an exact duplicate", async () => {
    upload.mockRejectedValue(
      new ApiError(409, "This receipt is already on your tab.", "duplicate", { receipt_id: "old" })
    );
    addFiles([photo()]);
    await until(() => getItems()[0].status === "duplicate");
    expect(getItems()[0].receiptId).toBe("old");
  });

  it("carries a possible duplicate through so the app can ask", async () => {
    upload.mockResolvedValue({ ...ok(), possible_duplicate_of: "other" });
    addFiles([photo()]);
    await until(() => getItems()[0].status === "added");
    expect(getItems()[0].possibleDuplicateOf).toBe("other");
  });

  it("lets a failed upload be retried", async () => {
    upload.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ok());
    addFiles([photo()]);
    await until(() => getItems()[0].status === "error");
    retry(getItems()[0].id);
    await until(() => getItems()[0].status === "added");
  });

  it("sends PDFs as they are, with their name", async () => {
    upload.mockResolvedValue(ok());
    addFiles([new File(["%PDF"], "invoice.pdf", { type: "application/pdf" })]);
    await until(() => getItems()[0].status === "added");
    const [blob, name] = upload.mock.calls[0];
    expect(name).toBe("invoice.pdf");
    expect((blob as Blob).type).toBe("application/pdf");
    expect(quality).not.toHaveBeenCalled();
  });

  it("reads a file's type from its name when the picker leaves it blank", () => {
    expect(typeOf(new File(["x"], "IMG_0001.HEIC"))).toBe("image/heic");
    expect(typeOf(new File(["x"], "bill.pdf"))).toBe("application/pdf");
  });

  it(`takes up to ${MAX_BATCH} at once and skips other files`, () => {
    upload.mockReturnValue(new Promise(() => undefined)); // never finishes
    const files = Array.from({ length: MAX_BATCH + 3 }, (_, i) => photo(`r${i}.jpg`));
    const res = addFiles([...files, new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(res).toEqual({ added: MAX_BATCH, tooMany: 3, unsupported: 1 });
  });

  it("uploads at most two at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    upload.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await settle();
      inFlight--;
      return ok();
    });
    addFiles([photo("a.jpg"), photo("b.jpg"), photo("c.jpg"), photo("d.jpg")]);
    await until(() => getItems().every((i) => i.status === "added"));
    expect(peak).toBe(2);
  });

  describe("read in the background", () => {
    const processing = { id: "r9", status: "processing", merchant: "" };
    const slowUntil = async (fn: () => boolean) => {
      for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 25));
    };

    it("frees the upload slot, then fills in when the read is done", async () => {
      const heard = vi.fn();
      window.addEventListener("rw:uploaded", heard);
      upload.mockResolvedValue(processing);
      scan.mockResolvedValueOnce({ id: "r9", state: "reading" }).mockResolvedValue({
        id: "r9",
        state: "added",
        receipt: { id: "r9", status: "extracted", merchant: "Corner Market" },
        budget_alerts: [],
        possible_duplicate_of: null,
      });
      addFiles([photo()]);
      await until(() => getItems()[0].uploaded === true);
      expect(getItems()[0].status).toBe("reading");
      expect(heard).toHaveBeenCalledTimes(1); // on the tab already, as "reading"
      await slowUntil(() => getItems()[0].status === "added");
      expect(getItems()[0].title).toBe("Corner Market is on your tab");
      expect(heard).toHaveBeenCalledTimes(2);
      window.removeEventListener("rw:uploaded", heard);
    });

    it("shows the reason when the read refuses it", async () => {
      upload.mockResolvedValue(processing);
      scan.mockResolvedValue({
        id: "r9",
        state: "refused",
        code: "not_a_receipt",
        message: "That doesn't look like a receipt.",
        receipt: null,
      });
      addFiles([photo()]);
      await slowUntil(() => getItems()[0].status === "refused");
      expect(getItems()[0].title).toBe("Not a receipt");
      expect(getItems()[0].message).toBe("That doesn't look like a receipt.");
    });

    it("says when it joined an Apple Pay tap", async () => {
      upload.mockResolvedValue(processing);
      scan.mockResolvedValue({
        id: "r9",
        state: "joined",
        receipt: { id: "tap1", status: "extracted", merchant: "Shell" },
        budget_alerts: [],
        possible_duplicate_of: null,
      });
      addFiles([photo()]);
      await slowUntil(() => getItems()[0].status === "added");
      expect(getItems()[0].title).toBe("Joined to your Apple Pay tap at Shell");
      expect(getItems()[0].receiptId).toBe("tap1");
    });

    it("keeps asking through a network blip", async () => {
      upload.mockResolvedValue(processing);
      scan.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({
        id: "r9",
        state: "added",
        receipt: { id: "r9", status: "extracted", merchant: "Corner Market" },
        budget_alerts: [],
        possible_duplicate_of: null,
      });
      addFiles([photo()]);
      await slowUntil(() => getItems()[0].status === "added");
      expect(scan).toHaveBeenCalledTimes(2);
    });
  });
});
