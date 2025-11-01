# Diff Viewer Implementation

This document describes the diff viewer feature added to Forge.

## Features

- **Unified and Split Views**: Toggle between traditional unified diff and side-by-side split view
- **GitHub-style Rendering**: Clean, modern interface similar to GitHub's diff viewer
- **File Statistics**: Visual bars showing additions/deletions per file
- **Collapsible Files**: Expand/collapse individual files for easier navigation
- **Full Diff Display**: No truncation - shows complete diffs
- **Server-Side Rendering**: All HTML generated on the server for performance

## Architecture

### Parser (`src/git/diff-parser.ts`)
Parses git unified diff output into structured TypeScript data:
- Files with metadata (path, type, stats)
- Hunks with line ranges
- Individual lines with type (add/delete/context)

### Renderer (`src/views/diff.ts`)
Generates HTML for both views:
- Unified: Single column with line numbers
- Split: Side-by-side comparison
- File headers with stats bars
- Proper handling of binary files, renames, etc.

### Styling (`src/views/layout.ts`)
GitHub-inspired CSS:
- Green for additions (#e6ffed)
- Red for deletions (#ffeef0)
- Clean typography and spacing
- Responsive layout

### Interactivity (`src/views/diff-scripts.ts`)
Minimal vanilla JavaScript for:
- View toggle (unified ↔ split)
- File collapse/expand
- Progressive enhancement

## Usage

The diff viewer automatically appears on all merge request detail pages.
Toggle between views using the buttons at the top of the diff.
