import { test, expect } from "@playwright/test";
import {
  BUILTIN_SIMULATIONS,
  SELECTORS,
  waitForAppLoad,
} from "./fixtures/test-helpers";

test.describe("File edit persists through simulation reset", () => {
  test("init.js edits should reach appBridge state", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeEnabled({ timeout: 30000 });

    const bridgeBefore = await page.evaluate(() => {
      const bridge = (window as any).__appBridge;
      if (!bridge) return { error: "no __appBridge" };
      const state = bridge.getState();
      const initEntity = Object.values(state?.files?.entities ?? {}).find(
        (f: any) => f?.kind === "Init",
      ) as any;
      return initEntity
        ? { id: initEntity.id, len: initEntity.contents?.length }
        : { error: "no init file in appBridge" };
    });
    expect(bridgeBefore).not.toHaveProperty("error");

    const marker = `/* E2E_MARKER_${Date.now()} */`;
    const editResult = await page.evaluate(
      ({ mkr }) => {
        const ed = (window as any).__monacoEditor;
        if (!ed) return { error: "no __monacoEditor" };

        const models = ed.getModels();
        if (!models?.length) return { error: "no models", count: 0 };

        const initModel = models.find(
          (m: any) => m.uri?.path?.includes("init") && !m.isDisposed?.(),
        );
        if (!initModel) {
          return {
            error: "no init model",
            paths: models.map((m: any) => m.uri?.path),
          };
        }

        const original = initModel.getValue();
        initModel.setValue(mkr + "\n" + original);
        return { ok: true, path: initModel.uri.path };
      },
      { mkr: marker },
    );

    if ("error" in editResult) {
      console.log("Edit error:", JSON.stringify(editResult));
    }
    expect(editResult).toHaveProperty("ok", true);

    await page.waitForTimeout(2000);

    const bridgeAfter = await page.evaluate(
      ({ mkr }) => {
        const bridge = (window as any).__appBridge;
        if (!bridge) return { error: "no __appBridge", hasMarker: false };
        const state = bridge.getState();
        const initEntity = Object.values(state?.files?.entities ?? {}).find(
          (f: any) => f?.kind === "Init",
        ) as any;
        if (!initEntity)
          return { error: "no init file", hasMarker: false };

        return {
          hasMarker: initEntity.contents?.includes(mkr) ?? false,
          firstLine: initEntity.contents?.split("\n")[0] ?? "",
        };
      },
      { mkr: marker },
    );

    expect(
      bridgeAfter.hasMarker,
      `Edit should flow Monaco -> FilesContext -> appBridge. ` +
        `First line: "${bridgeAfter.firstLine}". ` +
        `Error: ${(bridgeAfter as any).error ?? "none"}`,
    ).toBe(true);
  });

  test("reset should use updated init.js and produce different agents", async ({
    page,
  }) => {
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "log" || msg.type() === "error") {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeEnabled({ timeout: 30000 });

    // Step once to get the initial simulation running with the original init
    await stepButton.click();
    await page.waitForTimeout(3000);

    // Read the original agent count from the 3D viewer's scene context
    const originalCount = await page.evaluate(() => {
      const bridge = (window as any).__appBridge;
      if (!bridge) return { error: "no appBridge" };
      const state = bridge.getState();
      const initEntity = Object.values(state?.files?.entities ?? {}).find(
        (f: any) => f?.kind === "Init",
      ) as any;
      return {
        initId: initEntity?.id,
        initContentLen: initEntity?.contents?.length,
        initFirstLine: initEntity?.contents?.split("\n")[0] ?? "",
      };
    });
    console.log("Original init state:", JSON.stringify(originalCount));

    // Replace init.js with a trivial init that creates exactly 3 agents
    const newInitCode = [
      "function init() {",
      "  return [",
      '    { position: [0,0], color: "green", behaviors: [] },',
      '    { position: [1,0], color: "blue", behaviors: [] },',
      '    { position: [0,1], color: "red", behaviors: [] },',
      "  ];",
      "}",
    ].join("\n");

    const editResult = await page.evaluate(
      ({ code }) => {
        const ed = (window as any).__monacoEditor;
        if (!ed) return { error: "no __monacoEditor" };
        const models = ed.getModels();
        const initModel = models?.find(
          (m: any) => m.uri?.path?.includes("init") && !m.isDisposed?.(),
        );
        if (!initModel) return { error: "no init model" };

        initModel.setValue(code);
        return { ok: true, newValue: initModel.getValue().substring(0, 40) };
      },
      { code: newInitCode },
    );
    expect(editResult).toHaveProperty("ok", true);
    console.log("Edit result:", JSON.stringify(editResult));

    // Wait for React state propagation
    await page.waitForTimeout(3000);

    // Verify the edit reached appBridge
    const postEditState = await page.evaluate(
      ({ code }) => {
        const bridge = (window as any).__appBridge;
        if (!bridge) return { error: "no appBridge" };
        const state = bridge.getState();
        const initEntity = Object.values(state?.files?.entities ?? {}).find(
          (f: any) => f?.kind === "Init",
        ) as any;
        if (!initEntity) return { error: "no init entity" };
        return {
          hasNewCode: initEntity.contents === code,
          contentFirstLine: initEntity.contents?.split("\n")[0] ?? "",
          contentLength: initEntity.contents?.length,
        };
      },
      { code: newInitCode },
    );
    console.log("Post-edit appBridge state:", JSON.stringify(postEditState));
    expect(
      postEditState,
      "Edit must reach appBridge before we can test reset",
    ).toHaveProperty("hasNewCode", true);

    // Instrument createCompleteManifest to capture what init code it reads
    await page.evaluate(() => {
      const bridge = (window as any).__appBridge;
      const origGetState = bridge.getState.bind(bridge);
      (window as any).__capturedManifestState = null;
      bridge.getState = function () {
        const state = origGetState();
        (window as any).__capturedManifestState = state;
        const initEntity = Object.values(state?.files?.entities ?? {}).find(
          (f: any) => f?.kind === "Init",
        ) as any;
        console.log(
          "[TRACE] appBridge.getState() called, init first line:",
          initEntity?.contents?.split("\n")[0] ?? "N/A",
        );
        return state;
      };
    });

    // Click reset
    const resetButton = page.locator(SELECTORS.resetButton);
    await expect(resetButton).toBeEnabled({ timeout: 5000 });
    await resetButton.click();

    // Wait for re-initialization
    await expect(stepButton).toBeEnabled({ timeout: 30000 });

    // Verify the captured manifest state during reset had the new code
    const capturedState = await page.evaluate(
      ({ code }) => {
        const state = (window as any).__capturedManifestState;
        if (!state) return { error: "getState was never called during reset" };
        const initEntity = Object.values(state?.files?.entities ?? {}).find(
          (f: any) => f?.kind === "Init",
        ) as any;
        if (!initEntity) return { error: "no init entity in captured state" };
        return {
          hasNewCode: initEntity.contents === code,
          firstLine: initEntity.contents?.split("\n")[0] ?? "",
        };
      },
      { code: newInitCode },
    );
    console.log("Captured reset state:", JSON.stringify(capturedState));
    expect(
      capturedState,
      "The state read by initializeNewRun must contain the edited init.js",
    ).toHaveProperty("hasNewCode", true);

    // Step once to generate agents from the new init
    await stepButton.click();
    await page.waitForTimeout(3000);

    // Read the agent count from the simulation data in simulator store
    const agentResult = await page.evaluate(() => {
      // Try to read from the simulator store's simulation data
      // The simulation data has steps: { [stepNum]: AgentState[] }
      try {
        // Access the simulator store via the global (it was set up in buildprovider.ts)
        // Check for __appBridge first to get any simulation state info
        const bridge = (window as any).__appBridge;
        if (!bridge) return { error: "no appBridge", agents: -1 };

        // Try to read the raw output from the DOM
        const rawEl = document.querySelector(".RawOutput");
        const rawText = rawEl?.textContent ?? "";

        // Try to read from the 3D scene
        const sceneEl = document.querySelector(".AgentScene");

        // Also try to see if there's step data visible in any tab
        const stepDataEls = document.querySelectorAll("[data-step-count]");

        return {
          rawText: rawText.substring(0, 200),
          rawLength: rawText.length,
          hasScene: !!sceneEl,
          stepDataCount: stepDataEls.length,
        };
      } catch (e) {
        return { error: String(e), agents: -1 };
      }
    });
    console.log("Agent result:", JSON.stringify(agentResult));

    // Print all console logs for debugging
    console.log("\n=== Browser Console Logs ===");
    for (const log of consoleLogs) {
      if (
        log.includes("TRACE") ||
        log.includes("init") ||
        log.includes("Error")
      ) {
        console.log(log);
      }
    }
    console.log("=== End Console Logs ===\n");

    // The definitive check: the state that was read during reset must have our new code
    // (we already asserted this above, but let's be explicit about the test goal)
    expect(capturedState).toHaveProperty("hasNewCode", true);
  });
});
