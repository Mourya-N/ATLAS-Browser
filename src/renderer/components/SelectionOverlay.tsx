import React from 'react';
import { BookOpen, Globe, HelpCircle, PenLine, Search, X } from 'lucide-react';
import { useLavrayStore } from '../store/useLavrayStore';
import { HayaMark } from './BrandMarks';

export const SelectionOverlay: React.FC = () => {
  const {
    selectionOverlay,
    setSelectionOverlay,
    activeConversationId,
    setAgentPanelOpen
  } = useLavrayStore();

  if (!selectionOverlay || !selectionOverlay.text) return null;

  const runSelectionPrompt = async (promptPrefix: string) => {
    if (!activeConversationId) return;
    setAgentPanelOpen(true);
    const snippet = selectionOverlay.text;
    setSelectionOverlay(null);
    await window.lavray.startAgentRun({
      conversationId: activeConversationId,
      tabId: selectionOverlay.tabId,
      goal: `${promptPrefix}:\n\n"${snippet}"`,
      mode: 'ask',
      selectedText: snippet
    });
  };

  return (
    <div className="lavray-glass fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 rounded-xl border border-lavray-border px-2 py-1.5 shadow-lavray-float">
      <span className="max-w-[150px] truncate px-2 text-[11px] text-lavray-muted border-r border-lavray-border">
        &ldquo;{selectionOverlay.text}&rdquo;
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
        icon={<HayaMark className="h-3 w-3" />}
        label="Ask HAYA"
        onClick={() => void runSelectionPrompt('Answer key insights and context about this selection')}
      />
      <ActionBtn
        icon={<Search className="h-3 w-3" />}
        label="Search"
        onClick={async () => {
          const text = selectionOverlay.text;
          setSelectionOverlay(null);
          await window.lavray.createTab({ url: text, activate: true });
        }}
      />
      <button
        type="button"
        onClick={() => setSelectionOverlay(null)}
        className="rounded-lg p-1 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
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
    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-lavray-text hover:bg-lavray-accent hover:text-lavray-accent-fg transition-colors"
  >
    {icon}
    <span>{label}</span>
  </button>
);
