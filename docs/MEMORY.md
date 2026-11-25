# Local Memory System

Implemented in `src/main/memory/memory-service.ts` and persisted in the SQLite `memory` table.

## Categories

- `user_preference`
- `site_preference`
- `workflow_preference`
- `task_knowledge`
- `task_summary`

## Retrieval & Privacy Guardrails

- **Retrieval**: Combines tokenized TF-IDF lexical overlap, domain matching boost (`+0.75`), confidence weighting, and recency decay.
- **Sensitive Data Blocking**: `containsSensitiveData()` rejects any attempt to save passwords, credit card numbers, private keys, API keys (`AIza...`, `sk-...`), or Bearer tokens.
- **Private Browsing**: Memory retrieval and persistence are disabled for private tabs.
- **User Control**: All memory items can be searched, created, edited, deleted, cleared, or exported as JSON via **Menu → Local Memory**.
