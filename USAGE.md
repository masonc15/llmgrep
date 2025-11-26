# Usage

llmgrep supports two primary modes: interactive (default) and plain text output. The tool searches your Claude Code conversation history stored in `~/.claude/projects/`.

## Quick Start

```bash
llmgrep "your search query"
```

This runs an interactive semantic search. Navigate results with arrow keys, press Enter to copy the full conversation to your clipboard.

## Search Modes

### Interactive Mode (Default)

```bash
llmgrep "authentication flow"
```

Displays a visual results list with relevance bars, dates, and project names. Select a result to copy the entire conversation to clipboard.

Interactive mode automatically expands the search if no results are found at the default threshold.

### Plain Text Mode

```bash
llmgrep "authentication flow" --no-interactive
```

Outputs formatted results directly to stdout. Useful for piping to other tools or when you just need to read the matches.

## Threshold Presets

Control how closely results must match your query:

| Flag | Distance | Description |
|------|----------|-------------|
| `--strict` or `-s` | < 0.30 | Very specific matches only |
| `--precise` or `-p` | < 0.40 | High quality matches (default) |
| `--broad` or `-b` | < 0.55 | Cast a wider net |

```bash
llmgrep "react hooks" --strict     # Only near-exact matches
llmgrep "bug fixes" --broad        # Include loosely related results
```

### Custom Threshold

Set an exact distance threshold with `--max-distance` or `-m`:

```bash
llmgrep "database schema" -m 0.35
```

Values range from 0.0 (exact match) to 1.0 (completely unrelated). Lower values are stricter.

## Date Filtering

Narrow results to a specific time range:

```bash
llmgrep "refactoring" --after 2025-01-01
llmgrep "deployment" --before 2025-06-15
llmgrep "testing" --after 2025-01-01 --before 2025-03-01
```

Dates use YYYY-MM-DD format.

## Result Limits

Control how many results to display:

```bash
llmgrep "api endpoints" --limit 5
llmgrep "error handling" -l 20
```

Default limit is 10 results.

## Development Scripts

Run specific components directly with bun:

```bash
bun run search        # Interactive search (same as llmgrep)
bun run interactive   # Interactive search directly
bun run plain         # Plain text output
bun run extract       # Extract raw text from all conversations
```

## All Options

```
llmgrep <query> [options]

Threshold Options:
  --strict, -s          Very specific matches only (distance < 0.30)
  --precise, -p         High quality matches (distance < 0.40) [default]
  --broad, -b           Cast a wider net (distance < 0.55)
  --max-distance, -m    Custom distance threshold (0.0-1.0)
  --top-k <number>      Number of results to return

Filter Options:
  --after <date>        Only results after YYYY-MM-DD
  --before <date>       Only results before YYYY-MM-DD
  --limit, -l <n>       Max results to display (default: 10)

Other Options:
  --no-interactive      Use plain text output instead of interactive mode
  --context <number>    Lines of context before/after match
  --debug               Enable debug logging
  -h, --help            Show help message
```

## Examples

Search for authentication discussions from this year:

```bash
llmgrep "oauth implementation" --after 2025-01-01
```

Find all debugging sessions with loose matching:

```bash
llmgrep "debugging" --broad --limit 20
```

Quick lookup with strict matching:

```bash
llmgrep "useState hook" -s
```

Pipe to grep for further filtering:

```bash
llmgrep "api" --no-interactive | grep -i "error"
```
