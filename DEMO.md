# Demo: Testing the Diff Viewer

This file demonstrates the new GitHub-style diff viewer with various types of changes.

## Features

### Unified View
- Traditional diff format
- Side-by-side line numbers (old | new)
- Green for additions
- Red for deletions
- Context lines in white

### Split View  
- Side-by-side comparison
- Old code on left, new code on right
- Paired changes aligned
- Clear visual separation

### File Navigation
- Collapsible file headers
- File statistics with visual bars
- Jump links to specific files
- File type badges (added, deleted, renamed, binary)

### Statistics
- Per-file additions/deletions count
- Visual representation with colored bars
- Total summary at top

## Implementation Details

Built with pure server-side rendering:
- No client-side dependencies except vanilla JS for toggle/collapse
- Works without JavaScript (defaults to unified view)
- GitHub-inspired color scheme and styling
- Handles large diffs without truncation
- Special handling for binary files and renames

## Testing

To see this in action, push this branch to create a merge request!
