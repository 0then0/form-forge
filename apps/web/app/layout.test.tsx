import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context.shared-runtime";
import { act } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import RootLayout from "./layout";

it("can mount the root layout on the client without inert script warnings", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error("Missing test document");
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const root = createRoot(frameDocument);
  try {
    await act(async () => {
      root.render(
        <HeadManagerContext.Provider value={{ appDir: true }}>
          <RootLayout>Archived form</RootLayout>
        </HeadManagerContext.Provider>,
      );
    });
    expect(error.mock.calls.flat().join(" ")).not.toContain(
      "Encountered a script tag",
    );
  } finally {
    await act(async () => root.unmount());
    error.mockRestore();
    frame.remove();
  }
});
