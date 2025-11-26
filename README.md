# llmgrep

Semantic search for LLM conversation history. Currently supports Claude Code (~/.claude/projects).

Uses local embeddings via semtools to find semantically similar text without sending data to external APIs.

## Install

Requires Bun and semtools.

    npm install -g @llamaindex/semtools
    git clone https://github.com/masonc15/llmgrep
    cd llmgrep && bun install
    bun link

## Usage

    llmgrep "your query"

Flags: --strict (precise), --broad (wider), --after/--before (date filter).

## License

MIT
