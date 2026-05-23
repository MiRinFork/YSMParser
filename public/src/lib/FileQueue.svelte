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
  import { formatSize } from "./format.js";

  interface Props {
    files: File[];
    onRemove?: (index: number) => void;
  }
  let { files, onRemove }: Props = $props();
</script>

<div class="file-queue">
  {#if files.length === 0}
    <div class="empty-state">
      <span>No files selected</span>
    </div>
  {:else}
    {#each files as file, i}
      <div class="file-item">
        <span class="file-index">{String(i + 1).padStart(2, "0")}</span>
        <div class="file-info">
          <strong class="file-name">{file.name}</strong>
          <span class="file-size">{formatSize(file.size)}</span>
        </div>
        {#if onRemove}
          <button
            class="remove-btn"
            onclick={() => onRemove(i)}
            aria-label="Remove {file.name}"
            title="Remove"
          >✕</button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .file-queue {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 3rem;
  }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface-2);
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .file-index {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    min-width: 1.4rem;
  }
  .file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .file-name {
    font-size: 0.85rem;
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-size {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.12s, background 0.12s;
  }
  .remove-btn:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
</style>
