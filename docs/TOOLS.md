# Agent Tool System & CDP Perception

All browser-agent tools are registered in `src/main/agent/tool-registry.ts` and `src/main/agent/tools/browser-tools.ts`, and validated with Ajv JSON Schemas prior to `PermissionGate` authorization.

## Tool Catalog

- **Navigation & Tabs**: `navigate`, `open_tab`, `switch_tab`, `close_tab`, `wait_for_navigation`
- **Interaction**: `click`, `type`, `select`, `scroll`, `hover`, `drag`, `press_key`
- **Perception & Extraction**: `read_page`, `read_selected_text`, `extract`, `screenshot`, `inspect_accessibility`, `inspect_dom`, `find_element`, `get_element_text`, `get_element_attributes`, `get_current_url`, `get_page_title`, `wait_for`, `wait_for_element`, `capture_page_diff`, `compare_tabs`
- **Browser Data**: `search_history`, `search_bookmarks`
- **Sensitive Actions**: `upload_file`, `download_file`, and experimental `run_page_script` (disabled by default)

## Perception & Targeting (`src/main/cdp/`)

- **CDPManager**: Manages `webContents.debugger` (`1.3`) sessions per tab and detaches cleanly on tab close or emergency kill switch.
- **PerceptionEngine**: Captures AXTree summaries, interactive DOM elements (including Shadow DOM and same-origin iframes), readable page text/headings/tables, and optional PNG screenshots with Set-of-Marks target boxes.
- **ElementResolver**: Assigns session-scoped `data-lavray-id` markers and re-verifies existence, visibility, interactability, and `elementFromPoint` overlay clearance before every interaction.
