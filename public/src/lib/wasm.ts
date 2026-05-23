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
  onProgress: (pct: number, label: string) => void
): Promise<OutputFile[]> {
  const { FS } = mod;

  wipeDir(FS, "/input");
  wipeDir(FS, "/output");
  ensureDir(FS, "/input");
  ensureDir(FS, "/output");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bytes = new Uint8Array(await file.arrayBuffer());
    FS.writeFile(`/input/${file.name}`, bytes);
    onProgress(
      (i / Math.max(1, files.length)) * 20,
      `Preparing ${i + 1} / ${files.length}`
    );
  }

  const exitCode = mod.callMain(["-i", "/input", "-o", "/output"]);
  if (typeof exitCode === "number" && exitCode !== 0) {
    throw new Error(`Parser exited with code ${exitCode}`);
  }

  return collectOutputFiles(FS, "/output");
}

function collectOutputFiles(
  FS: WasmModule["FS"],
  root: string
): OutputFile[] {
  const result: OutputFile[] = [];
  const walk = (dir: string, relativeBase: string) => {
    const entries = FS.readdir(dir).filter((n) => n !== "." && n !== "..");
    for (const entry of entries) {
      const fullPath = `${dir}/${entry}`;
      const relPath = relativeBase ? `${relativeBase}/${entry}` : entry;
      const stat = FS.stat(fullPath);
      if (FS.isDir(stat.mode)) {
        walk(fullPath, relPath);
      } else {
        result.push({ path: relPath, data: FS.readFile(fullPath) });
      }
    }
  };
  walk(root, "");
  return result;
}
