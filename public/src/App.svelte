<!-- The frontend of YSMParser.
  - Copyright (C) 2026 MiRinChan
  - This program is free software; you can redistribute it and/or modify
  - it under the terms of the GNU General Public License as published by
  - the Free Software Foundation; either version 2 of the License, or
  - (at your option) any later version.
  -
  - This program is distributed in the hope that it will be useful,
  - but WITHOUT ANY WARRANTY; without even the implied warranty of
  - MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.See the
  - GNU General Public License for more details.
  -
  - You should have received a copy of the GNU General Public License along
  - with this program; if not, see < https://www.gnu.org/licenses/>.
  -->

<script lang="ts">
  import { onMount } from "svelte";
  import DropZone from "./lib/DropZone.svelte";
  import FileQueue from "./lib/FileQueue.svelte";
  import ProgressBar from "./lib/ProgressBar.svelte";
  import LogConsole from "./lib/LogConsole.svelte";
  import SettingsModal from "./lib/SettingsModal.svelte";
  import { formatSize } from "./lib/format.js";
  import {
    isTauri,
    runParserNative,
    getSavedOutputDir,
    openPathInFileBrowser,
    writeTempInputFiles,
  } from "./lib/tauri.js";
  import { type WasmModule, type OutputFile, initWasm, runWasm } from "./lib/wasm.js";
  import JSZip from "jszip";

  // ── state ──────────────────────────────────────────────────────────────────
  let files = $state<File[]>([]);
  let logs = $state<string[]>([]);
  let progress = $state(0);
  let progressLabel = $state("Idle");
  let running = $state(false);
  let outputFiles = $state<OutputFile[]>([]);
  let outputZip = $state<Blob | null>(null);
  let outputDir = $state<string>("");
  let showSettings = $state(false);
  let wasmMod = $state<WasmModule | null>(null);
  let wasmReady = $state(false);
  let wasmError = $state("");

  // ── derived ────────────────────────────────────────────────────────────────
  let totalSize = $derived(files.reduce((s, f) => s + f.size, 0));
  let canRun = $derived(
    files.length > 0 && !running && (isTauri ? !!outputDir : wasmReady)
  );

  // ── init ───────────────────────────────────────────────────────────────────
  onMount(async () => {
    if (isTauri) {
      const saved = await getSavedOutputDir();
      if (saved) {
        outputDir = saved;
      } else {
        showSettings = true;
      }
    } else {
      try {
        wasmMod = await initWasm((line) => {
          logs = [...logs, line];
        });
        wasmReady = true;
        log("WASM runtime ready.");
      } catch (err) {
        wasmError = String(err instanceof Error ? err.message : err);
        log(`Runtime error: ${wasmError}`);
      }
    }
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  function log(line: string) {
    logs = [...logs, line];
  }

  function setProgress(pct: number, label: string) {
    progress = pct;
    progressLabel = label;
  }

  function addFiles(newFiles: File[]) {
    const names = new Set(files.map((f) => f.name));
    const deduped = newFiles.filter((f) => !names.has(f.name));
    files = [...files, ...deduped];
    outputZip = null;
    outputFiles = [];
  }

  function removeFile(i: number) {
    files = files.filter((_, idx) => idx !== i);
  }

  // ── run parser ─────────────────────────────────────────────────────────────
  async function run() {
    if (!canRun) return;
    running = true;
    logs = [];
    outputFiles = [];
    outputZip = null;
    setProgress(2, "Starting…");

    try {
      if (isTauri) {
        await runTauri();
      } else {
        await runWasmMode();
      }
    } catch (err) {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setProgress(0, "Failed");
    } finally {
      running = false;
    }
  }

  async function runTauri() {
    log("Writing input files to temp directory…");
    setProgress(10, "Preparing files");

    const inputData = await Promise.all(
      files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
    );
    const inputDir = await writeTempInputFiles(inputData);
    setProgress(25, "Running parser");
    log(`Input temp dir: ${inputDir}`);
    log(`Output dir: ${outputDir}`);

    const stdout = await runParserNative(inputDir, outputDir);
    if (stdout) {
      for (const line of stdout.split("\n").filter(Boolean)) log(line);
    }

    setProgress(100, "Done");
    log(`Done. Files saved to: ${outputDir}`);
  }

  async function runWasmMode() {
    if (!wasmMod) throw new Error("WASM runtime not ready");
    log("Preparing files…");

    const out = await runWasm(wasmMod, files, (pct, label) =>
      setProgress(pct, label)
    );
    setProgress(76, "Packaging");
    log(`Parser finished. ${out.length} output file(s).`);
    outputFiles = out;

    const zip = new JSZip();
    for (const f of out) zip.file(f.path, f.data);
    outputZip = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    setProgress(100, `${out.length} file(s) ready`);
    log(`ZIP ready — ${out.length} file(s).`);
  }

  // ── download ───────────────────────────────────────────────────────────────
  function download() {
    if (!outputZip) return;
    const url = URL.createObjectURL(outputZip);
    const a = document.createElement("a");
    a.href = url;
    a.download = "YSMParser-output.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function openOutputFolder() {
    if (outputDir) await openPathInFileBrowser(outputDir);
  }

  function clear() {
    files = [];
    logs = [];
    outputFiles = [];
    outputZip = null;
    setProgress(0, "Idle");
  }
</script>

<!-- ── Settings modal ────────────────────────────────────────────────── -->
{#if showSettings}
  <SettingsModal
    outputDir={outputDir}
    onClose={() => (showSettings = false)}
    onSave={(dir) => (outputDir = dir)}
  />
{/if}

<!-- ── Main layout ───────────────────────────────────────────────────── -->
<div class="shell">
  <!-- Header -->
  <header class="header">
    <div class="brand">
      <svg class="brand-icon" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="var(--accent)" />
        <path d="M7 20L14 8l7 12H7z" fill="#000" />
      </svg>
      <span class="brand-name">YSMParser</span>
    </div>
    <div class="header-right">
      {#if isTauri}
        <span class="dir-badge" title={outputDir || "No output folder set"}>
          {outputDir ? outputDir.split(/[\\/]/).pop() : "No folder"}
        </span>
      {:else}
        <span class="runtime-badge" class:ready={wasmReady} class:error={!!wasmError}>
          {wasmReady ? "WASM Ready" : wasmError ? "Runtime Error" : "Loading…"}
        </span>
      {/if}
      {#if isTauri}
        <button
          class="icon-btn"
          onclick={() => (showSettings = true)}
          title="Settings"
          aria-label="Open settings"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
          </svg>
        </button>
      {/if}
    </div>
  </header>

  <!-- Body -->
  <main class="main">
    <!-- Left panel: files -->
    <section class="panel panel-files">
      <div class="panel-head">
        <h2 class="panel-title">Input Files</h2>
        <span class="panel-meta">
          {files.length} file{files.length !== 1 ? "s" : ""}
          {files.length > 0 ? `· ${formatSize(totalSize)}` : ""}
        </span>
      </div>

      <DropZone onFiles={addFiles} disabled={running} />

      <div class="queue-wrap">
        <FileQueue {files} onRemove={running ? undefined : removeFile} />
      </div>

      <!-- Actions -->
      <div class="actions">
        <button
          class="btn btn-primary"
          onclick={run}
          disabled={!canRun}
        >
          {running ? "Running…" : "Run Parser"}
        </button>

        {#if !isTauri && outputZip}
          <button class="btn btn-secondary" onclick={download}>
            Download ZIP
          </button>
        {/if}

        {#if isTauri && outputDir && progress === 100}
          <button class="btn btn-secondary" onclick={openOutputFolder}>
            Open Folder
          </button>
        {/if}

        {#if files.length > 0 || logs.length > 0}
          <button class="btn btn-ghost" onclick={clear} disabled={running}>
            Clear
          </button>
        {/if}
      </div>
    </section>

    <!-- Right panel: progress + log -->
    <section class="panel panel-log">
      <div class="panel-head">
        <h2 class="panel-title">Output</h2>
        {#if outputFiles.length > 0}
          <span class="panel-meta">{outputFiles.length} file(s)</span>
        {/if}
      </div>

      <ProgressBar percent={progress} label={progressLabel} />

      <LogConsole lines={logs} />

      {#if isTauri && outputDir}
        <div class="output-dir-note">
          <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
            <path d="M1 3.5A1.5 1.5 0 012.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
          </svg>
          <code>{outputDir}</code>
        </div>
      {/if}
    </section>
  </main>

  <footer class="footer">
    <span>YSMParser · <a href="https://github.com/OpenYSM/YSMParser" target="_blank" rel="noopener">GitHub</a></span>
  </footer>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100dvh;
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-1);
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .brand-icon {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }
  .brand-name {
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: -0.01em;
    color: var(--text-primary);
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .runtime-badge {
    font-size: 0.72rem;
    font-family: var(--font-mono);
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }
  .runtime-badge.ready {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 30%, transparent);
  }
  .runtime-badge.error {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  }
  .dir-badge {
    font-size: 0.72rem;
    font-family: var(--font-mono);
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.35rem 0.45rem;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: color 0.12s, border-color 0.12s;
  }
  .icon-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  /* ── Main ── */
  .main {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    padding: 1.25rem 1.5rem;
    min-height: 0;
  }
  @media (max-width: 768px) {
    .main {
      grid-template-columns: 1fr;
    }
  }

  /* ── Panels ── */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.1rem 1.25rem;
    min-height: 0;
  }
  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .panel-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .panel-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .queue-wrap {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    max-height: 22rem;
  }

  /* ── Actions ── */
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding-top: 0.1rem;
  }
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-size: 0.83rem;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.12s, opacity 0.12s;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--accent);
    color: #000;
  }
  .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 82%, #fff);
  }
  .btn-secondary {
    background: var(--surface-3);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .btn-ghost {
    background: none;
    color: var(--text-muted);
    border: 1px solid transparent;
  }
  .btn-ghost:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border);
  }

  /* ── Output dir note ── */
  .output-dir-note {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 0.4rem 0.65rem;
    background: var(--surface-2);
    border-radius: 6px;
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .output-dir-note code {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* ── Footer ── */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1.5rem;
    border-top: 1px solid var(--border);
    font-size: 0.72rem;
    color: var(--text-muted);
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
