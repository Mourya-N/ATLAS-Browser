import React from 'react';
import { BookOpen, Globe, HelpCircle, PenLine, Search, Sparkles, X } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const SelectionOverlay: React.FC = () => {
  const {
    selectionOverlay,
    setSelectionOverlay,
    activeConversationId,
    setAgentPanelOpen
  } = useAtlasStore();

  if (!selectionOverlay || !selectionOverlay.text) return null;

  const runSelectionPrompt = async (promptPrefix: string) => {
    if (!activeConversationId) return;
    setAgentPanelOpen(true);
    const snippet = selectionOverlay.text;
    setSelectionOverlay(null);
    await window.atlas.startAgentRun({
      conversationId: activeConversationId,
      tabId: selectionOverlay.tabId,
      goal: `${promptPrefix}:\n\n"${snippet}"`,
      mode: 'ask',
      selectedText: snippet
    });
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-full border border-atlas-border bg-atlas-surface/95 px-2.5 py-1.5 shadow-2xl backdrop-blur">
      <span className="max-w-[160px] truncate px-2 text-[11px] text-atlas-muted border-r border-atlas-border">
        "{selectionOverlay.text}"
      </span>
      <ActionBtn
        icon={<HelpCircle className="h-3 w-3" />}
        label="Explain"
        onClick={() => void runSelectionPrompt('Explain the selected text clearly')}
      />
      <ActionBtn
        icon={<BookOpen className="h-3 w-3" />}
        label="Summarize"
        onClick={() => void runSelectionPrompt('Summarize the selected text concisely')}
      />
      <ActionBtn
        icon={<Globe className="h-3 w-3" />}
        label="Translate"
        onClick={() => void runSelectionPrompt('Translate the selected text to English (or explain if already English)')}
      />
      <ActionBtn
        icon={<PenLine className="h-3 w-3" />}
        label="Rewrite"
        onClick={() => void runSelectionPrompt('Rewrite the selected text clearly and professionally')}
      />
      <ActionBtn
        icon={<Sparkles className="h-3 w-3" />}
        label="Ask"
        onClick={() => void runSelectionPrompt('Answer key insights and context about this selection')}
      />
      <ActionBtn
        icon={<Search className="h-3 w-3" />}
        label="Search"
        onClick={async () => {
          const text = selectionOverlay.text;
          setSelectionOverlay(null);
          await window.atlas.createTab({ url: text, activate: true });
        }}
      />
      <button
        type="button"
        onClick={() => setSelectionOverlay(null)}
        className="rounded-full p-1 text-atlas-muted hover:bg-atlas-elevated"
        aria-label="Dismiss selection actions"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

const ActionBtn: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({
  icon,
  label,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-atlas-text hover:bg-atlas-accent hover:text-white transition-colors"
  >
    {icon}
    <span>{label}</span>
  </button>
);
