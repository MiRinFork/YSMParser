/* The frontend of YSMParser.
// Copyright (C) 2026 MiRinChan
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License along
// with this program; if not, see < https://www.gnu.org/licenses/>.
*/

declare global {
  interface Window {
    YSMParserModule?: (opts: unknown) => Promise<WasmModule>;
    Module?: (opts: unknown) => Promise<WasmModule>;
  }
}

export interface WasmModule {
  FS: {
    mkdir(path: string): void;
    readdir(path: string): string[];
    readFile(path: string): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
    rmdir(path: string): void;
    stat(path: string): { mode: number };
    isDir(mode: number): boolean;
  };
  callMain(args: string[]): number;
}

export interface OutputFile {
  path: string;
  data: Uint8Array;
}

export interface RunWasmOptions {
  maxBatchBytes?: number;
  onOutputFile?: (file: OutputFile) => void;
  onProgress: (pct: number, label: string) => void;
}

export interface RunWasmResult {
  outputCount: number;
  outputBytes: number;
  batchCount: number;
}

const DEFAULT_MAX_BATCH_BYTES = 96 * 1024 * 1024;

export async function initWasm(
  onLog: (text: string) => void
): Promise<WasmModule> {
  const factory =
    window.YSMParserModule ??
    window.Module ??
    // @ts-ignore
    globalThis.YSMParserModule ??
    // @ts-ignore
    globalThis.Module;

  if (typeof factory !== "function") {
    const msg = await diagnoseFactoryError();
    throw new Error(msg);
  }

  return factory({
    noInitialRun: true,
    print: (text: string) => onLog(text),
    printErr: (text: string) => onLog(text),
    locateFile: (path: string) => `./${path}`,
  });
}

async function diagnoseFactoryError(): Promise<string> {
  try {
    const response = await fetch("./YSMParser.js", { cache: "no-store" });
    if (response.ok) {
      const source = await response.text();
      if (
        source.includes('require("node:fs")') ||
        source.includes("require('node:fs')") ||
        source.includes("NODERAWFS") ||
        source.includes("ENVIRONMENT_IS_NODE=true")
      ) {
        return "WASM file mismatch — place the web build of YSMParser.js alongside this page.";
      }
    }
  } catch {
    // ignore
  }
  return "WASM runtime not available — make sure YSMParser.js and YSMParser.wasm are in the same directory.";
}

function wipeDir(FS: WasmModule["FS"], dir: string): void {
  try {
    const entries = FS.readdir(dir).filter((n) => n !== "." && n !== "..");
    for (const entry of entries) {
      const full = `${dir}/${entry}`;
      const stat = FS.stat(full);
      if (FS.isDir(stat.mode)) {
        wipeDir(FS, full);
        FS.rmdir(full);
      } else {
        FS.unlink(full);
      }
    }
  } catch {
    // ignore
  }
}

function ensureDir(FS: WasmModule["FS"], dir: string): void {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      FS.mkdir(current);
    } catch {
      // already exists
    }
  }
}

export async function runWasm(
  mod: WasmModule,
  files: File[],
  options: RunWasmOptions
): Promise<RunWasmResult> {
  const { FS } = mod;
  const batches = makeFileBatches(
    files,
    options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES
  );
  let outputCount = 0;
  let outputBytes = 0;

  if (batches.length === 0) {
    return { outputCount: 0, outputBytes: 0, batchCount: 0 };
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchNumber = batchIndex + 1;
    const batchBase = (batchIndex / batches.length) * 75;
    const batchSpan = 75 / batches.length;

    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    ensureDir(FS, "/input");
    ensureDir(FS, "/output");

    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      const bytes = new Uint8Array(await file.arrayBuffer());
      FS.writeFile(`/input/${file.name}`, bytes);
      options.onProgress(
        batchBase + (i / Math.max(1, batch.length)) * batchSpan * 0.35,
        `Loading batch ${batchNumber} / ${batches.length}`
      );
    }

    options.onProgress(
      batchBase + batchSpan * 0.35,
      `Parsing batch ${batchNumber} / ${batches.length}`
    );
    const exitCode = mod.callMain(["-i", "/input", "-o", "/output"]);
    if (typeof exitCode === "number" && exitCode !== 0) {
      throw new Error(`Parser exited with code ${exitCode}`);
    }

    options.onProgress(
      batchBase + batchSpan * 0.9,
      `Collecting batch ${batchNumber} / ${batches.length}`
    );
    const batchOutput = collectOutputFiles(FS, "/output", options.onOutputFile);
    outputCount += batchOutput.count;
    outputBytes += batchOutput.bytes;

    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    options.onProgress(
      batchBase + batchSpan,
      `Finished batch ${batchNumber} / ${batches.length}`
    );
  }

  return { outputCount, outputBytes, batchCount: batches.length };
}

function makeFileBatches(files: File[], maxBatchBytes: number): File[][] {
  const safeMax = Math.max(1, maxBatchBytes);
  const batches: File[][] = [];
  let batch: File[] = [];
  let batchBytes = 0;

  for (const file of files) {
    if (batch.length > 0 && batchBytes + file.size > safeMax) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }

    batch.push(file);
    batchBytes += file.size;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

function collectOutputFiles(
  FS: WasmModule["FS"],
  root: string,
  onOutputFile?: (file: OutputFile) => void
): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  const walk = (dir: string, relativeBase: string) => {
    const entries = FS.readdir(dir).filter((n) => n !== "." && n !== "..");
    for (const entry of entries) {
      const fullPath = `${dir}/${entry}`;
      const relPath = relativeBase ? `${relativeBase}/${entry}` : entry;
      const stat = FS.stat(fullPath);
      if (FS.isDir(stat.mode)) {
        walk(fullPath, relPath);
      } else {
        const data = FS.readFile(fullPath);
        count += 1;
        bytes += data.byteLength;
        onOutputFile?.({ path: relPath, data });
      }
    }
  };
  walk(root, "");
  return { count, bytes };
}
