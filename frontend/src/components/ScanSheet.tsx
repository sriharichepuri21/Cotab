"use client";

import { useRef, useSyncExternalStore } from "react";

import { getItems, subscribe } from "@/lib/scanQueue";

/** Shared queue state, re-rendered whenever an item moves on. */
export function useScanItems() {
  return useSyncExternalStore(subscribe, getItems, getItems);
}

type Picker = "camera" | "photos" | "files";

/**
 * Hidden file inputs for the three ways in. Kept outside the scanner so the
 * Scan button can open the camera directly, and "Retake" works after it
 * has closed.
 */
export function useScanPickers(onPicked: (files: File[]) => void) {
  const refs = {
    camera: useRef<HTMLInputElement>(null),
    photos: useRef<HTMLInputElement>(null),
    files: useRef<HTMLInputElement>(null),
  };
  const open = (which: Picker) => refs[which].current?.click();
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // picking the same photo again should still fire
    if (files.length) onPicked(files);
  };
  const inputs = (
    <>
      {/* Camera: one photo, straight from the back camera on phones. */}
      <input
        ref={refs.camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-camera"
      />
      {/* Photo library: several at once. */}
      <input
        ref={refs.photos}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-photos"
      />
      {/* Files: the system picker, which also reaches iCloud Drive, Google
          Drive, Dropbox and OneDrive when their apps are installed. */}
      <input
        ref={refs.files}
        type="file"
        accept="image/*,application/pdf,.pdf,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handle}
        data-testid="scan-files"
      />
    </>
  );
  return { open, inputs };
}
