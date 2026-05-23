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

type TauriGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  isTauri?: boolean;
};

const tauriGlobal = globalThis as TauriGlobal;

export const isTauri =
  typeof window !== "undefined" &&
  (tauriGlobal.isTauri === true ||
    "__TAURI__" in tauriGlobal ||
    "__TAURI_INTERNALS__" in tauriGlobal);

let _invoke: typeof import("@tauri-apps/api/core").invoke | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!_invoke) {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke;
  }
  return _invoke(cmd, args) as Promise<T>;
}

export async function runParserNative(
  inputDir: string,
  outputDir: string
): Promise<string> {
  return invoke<string>("run_parser", { inputDir, outputDir });
}

export async function openFolderDialog(): Promise<string | null> {
  return invoke<string | null>("open_folder_dialog");
}

export async function getSavedOutputDir(): Promise<string | null> {
  return invoke<string | null>("get_output_dir");
}

export async function setSavedOutputDir(dir: string): Promise<void> {
  return invoke("set_output_dir", { dir });
}

export async function openPathInFileBrowser(path: string): Promise<void> {
  return invoke("open_in_file_browser", { path });
}

export async function writeTempInputFiles(
  files: { name: string; data: Uint8Array }[]
): Promise<string> {
  return invoke<string>("write_temp_inputs", { files: files.map(f => ({ name: f.name, data: Array.from(f.data) })) });
}
