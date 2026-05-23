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

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const STORE_FILE: &str = "settings.json";

// ── file transfer type ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InputFile {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Default, Deserialize, Serialize)]
struct Settings {
    output_dir: Option<String>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join(STORE_FILE))
}

fn read_settings(path: &PathBuf) -> Result<Settings, String> {
    match fs::read_to_string(path) {
        Ok(raw) if raw.trim().is_empty() => Ok(Settings::default()),
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}

// ── commands ───────────────────────────────────────────────────────────────

#[tauri::command]
async fn write_temp_inputs(files: Vec<InputFile>) -> Result<String, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    for f in &files {
        let dest = dir.path().join(&f.name);
        fs::write(&dest, &f.data).map_err(|e| e.to_string())?;
    }
    // keep the dir alive by leaking it (temp dir lives for the process lifetime)
    let path = dir.into_path();
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn run_parser(
    app: tauri::AppHandle,
    input_dir: String,
    output_dir: String,
) -> Result<String, String> {
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let output = app
        .shell()
        .sidecar("YSMParser")
        .map_err(|e| e.to_string())?
        .args(["-i", &input_dir, "-o", &output_dir])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let msg = if stderr.is_empty() { stdout } else { stderr };
        return Err(msg);
    }

    let combined = if stderr.is_empty() {
        stdout
    } else {
        format!("{}\n{}", stdout, stderr)
    };
    Ok(combined)
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog().file().blocking_pick_folder();
    Ok(path
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn get_output_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store_path = settings_path(&app)?;
    Ok(read_settings(&store_path)?.output_dir)
}

#[tauri::command]
async fn set_output_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let store_path = app_data.join(STORE_FILE);

    let mut settings = read_settings(&store_path)?;
    settings.output_dir = Some(dir);
    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&store_path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_in_file_browser(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

// ── app entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            write_temp_inputs,
            run_parser,
            open_folder_dialog,
            get_output_dir,
            set_output_dir,
            open_in_file_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running YSMParser");
}
