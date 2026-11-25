import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Hand,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  XCircle
} from 'lucide-react';
import type { AgentMode, AgentStep } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

const SLASH_HINTS = [
  { cmd: '/summarize', desc: 'Summarize current page' },
  { cmd: '/extract', desc: 'Extract structured data' },
  { cmd: '/compare', desc: 'Compare open tabs' },
  { cmd: '/research', desc: 'Parallel multi-agent research' },
  { cmd: '/pause', desc: 'Pause active run' },
  { cmd: '/resume', desc: 'Resume paused run' },
  { cmd: '/stop', desc: 'Stop active run' },
  { cmd: '/help', desc: 'List slash commands' }
];

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const AgentPanel: React.FC = () => {
  const {
    agentPanelOpen,
    activeTabId,
    conversations,
    activeConversationId,
    setConversations,
    setActiveConversationId,
    messages,
    setMessages,
    activeRun,
    agentMode,
    setAgentMode,
    streamBuffer,
    subAgents,
    pushToast,
    setOverlayView
  } = useAtlasStore();

  const [goalInput, setGoalInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [stepScreenshots, setStepScreenshots] = useState<Record<string, string>>({});
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const SpeechRecognitionCtor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
      .SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
      .webkitSpeechRecognition;
  const voiceSupported = Boolean(SpeechRecognitionCtor);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeRun?.steps.length, streamBuffer]);

  useEffect(() => {
    if (!activeRun) return;
    for (const step of activeRun.steps) {
      if (step.screenshotPath && !stepScreenshots[step.id]) {
        void window.atlas.readScreenshotDataUrl(step.screenshotPath).then((url) => {
          if (url) setStepScreenshots((prev) => ({ ...prev, [step.id]: url }));
        });
      }
    }
  }, [activeRun?.steps.length]);

  if (!agentPanelOpen) return null;

  const isRunning =
    activeRun &&
    ['planning', 'running', 'paused', 'awaiting_confirmation', 'awaiting_hitl'].includes(activeRun.status);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const goal = goalInput.trim();
    if (!goal || !activeConversationId) return;
    setGoalInput('');
    await window.atlas.startAgentRun({
      conversationId: activeConversationId,
      tabId: activeTabId,
      goal,
      mode: agentMode
    });
    const refreshed = await window.atlas.getMessages(activeConversationId);
    setMessages(refreshed);
  };

  const toggleVoice = () => {
    if (!SpeechRecognitionCtor) {
      setVoiceError('Web Speech API is not supported on this platform/build.');
      return;
    }
    setVoiceError(null);
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const rec = new SpeechRecognitionCtor();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (ev) => {
        const transcript = Array.from(ev.results)
          .map((r) => r[0]?.transcript || '')
          .join(' ')
          .trim();
        setGoalInput(transcript);
      };
      rec.onerror = (ev) => {
        setVoiceError(`Voice error: ${ev.error}`);
        setRecording(false);
      };
      rec.onend = () => setRecording(false);
      recognitionRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Unable to start voice input');
      setRecording(false);
    }
  };

  const handleSaveSkill = async () => {
    if (!activeRun) return;
    const skill = await window.atlas.recordSkillFromRun(activeRun.id);
    pushToast(`Saved skill "${skill.name}"`, 'success');
  };

  const handleNewConversation = async () => {
    const conv = await window.atlas.createConversation(`Task ${conversations.length + 1}`);
    const list = await window.atlas.listConversations();
    setConversations(list);
    setActiveConversationId(conv.id);
    setMessages([]);
  };

  const handleClear = async () => {
    if (!activeConversationId) return;
    await window.atlas.clearConversation(activeConversationId);
    setMessages([]);
  };

  const subAgentList = Object.values(subAgents).filter(
    (s) => activeRun && s.parentRunId === activeRun.id
  );

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-atlas-border bg-atlas-surface select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-atlas-border px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-atlas-accent shrink-0" />
          <select
            value={activeConversationId || ''}
            onChange={async (e) => {
              const id = e.target.value;
              setActiveConversationId(id);
              const msgs = await window.atlas.getMessages(id);
              setMessages(msgs);
            }}
            className="max-w-[165px] truncate rounded-md bg-atlas-elevated px-2 py-1 text-xs font-semibold text-atlas-text outline-none"
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            title="New Task / Conversation"
            className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            title="Clear Conversation"
            className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-4 gap-1 border-b border-atlas-border bg-atlas-bg/60 p-1.5">
        {(['ask', 'assist', 'agent', 'takeover'] as AgentMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={async () => {
              setAgentMode(m);
              if (activeRun && isRunning) {
                await window.atlas.setAgentMode(activeRun.id, m);
              }
            }}
            className={`rounded-lg py-1 text-[11px] font-semibold capitalize transition-colors ${
              agentMode === m
                ? 'bg-atlas-accent text-white shadow-sm'
                : 'text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Live Run Status & Controls */}
      {activeRun && (
        <div className="border-b border-atlas-border bg-atlas-elevated/40 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-atlas-text truncate">
              Status:{' '}
              <span className="uppercase text-[10px] tracking-wide text-atlas-accent">
                {activeRun.status.replace('_', ' ')}
              </span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {isRunning && activeRun.status !== 'paused' && activeRun.status !== 'awaiting_hitl' && (
                <button
                  type="button"
                  onClick={() => void window.atlas.pauseAgentRun(activeRun.id)}
                  title="Pause"
                  className="rounded bg-atlas-surface p-1 text-atlas-muted hover:text-atlas-text border border-atlas-border"
                >
                  <Pause className="h-3 w-3" />
                </button>
              )}
              {(activeRun.status === 'paused' || activeRun.status === 'awaiting_hitl') && (
                <button
                  type="button"
                  onClick={() => void window.atlas.resumeAgentRun(activeRun.id)}
                  title="Resume"
                  className="rounded bg-atlas-success/20 p-1 text-atlas-success border border-atlas-success/40"
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
              {isRunning && (
                <>
                  <button
                    type="button"
                    onClick={() => void window.atlas.takeoverAgentRun(activeRun.id)}
                    title="Take Over Browser"
                    className="rounded bg-atlas-warning/20 p-1 text-atlas-warning border border-atlas-warning/40"
                  >
                    <Hand className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void window.atlas.stopAgentRun(activeRun.id)}
                    title="Stop Agent"
                    className="rounded bg-atlas-danger/20 p-1 text-atlas-danger border border-atlas-danger/40"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                </>
              )}
              {!isRunning && activeRun.status === 'completed' && activeRun.steps.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleSaveSkill()}
                  title="Save as Reusable Skill"
                  className="flex items-center gap-1 rounded bg-atlas-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-atlas-accent hover:bg-atlas-accent/25"
                >
                  <Save className="h-3 w-3" /> Save Skill
                </button>
              )}
              {!isRunning && activeRun.status === 'failed' && activeConversationId && (
                <button
                  type="button"
                  onClick={() =>
                    void window.atlas.startAgentRun({
                      conversationId: activeConversationId,
                      tabId: activeTabId,
                      goal: activeRun.goal,
                      mode: agentMode
                    })
                  }
                  title="Retry Task"
                  className="flex items-center gap-1 rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px] font-semibold text-atlas-text"
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              )}
            </div>
          </div>

          {activeRun.subgoals.length > 0 && (
            <div className="mt-2 space-y-1">
              {activeRun.subgoals.map((sg) => (
                <div key={sg.id} className="flex items-start gap-1.5 text-[11px]">
                  {sg.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-atlas-success mt-0.5" />
                  ) : sg.status === 'failed' ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-atlas-danger mt-0.5" />
                  ) : (
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        sg.status === 'in_progress' ? 'bg-atlas-accent animate-pulse' : 'bg-atlas-border'
                      }`}
                    />
                  )}
                  <span className={sg.status === 'completed' ? 'text-atlas-muted line-through' : 'text-atlas-text'}>
                    {sg.description}
                  </span>
                </div>
              ))}
            </div>
          )}

          {subAgentList.length > 0 && (
            <div className="mt-2 rounded-lg border border-atlas-border bg-atlas-surface p-2 space-y-1">
              <div className="text-[10px] font-semibold uppercase text-atlas-muted">Parallel Sub-Agents</div>
              {subAgentList.map((sa) => (
                <div key={sa.subAgentId} className="flex items-center justify-between text-[11px]">
                  <span className="truncate flex-1">{sa.task}</span>
                  <span className="ml-2 shrink-0 rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px] uppercase">
                    {sa.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center justify-between text-[10px] text-atlas-muted">
            <span>
              Tokens: {(activeRun.totalInputTokens + activeRun.totalOutputTokens).toLocaleString()}
            </span>
            <span>
              Cost: ${activeRun.estimatedCostUsd.toFixed(4)}
              {activeRun.isCostEstimated ? ' (est.)' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Conversation & Step Timeline */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !activeRun && (
          <div className="rounded-xl border border-dashed border-atlas-border p-4 text-xs text-atlas-muted space-y-2">
            <div className="font-semibold text-atlas-text">Atlas Browser Agent</div>
            <p>
              Browse normally, or ask Atlas to research, extract structured data, compare tabs, or automate multi-step workflows.
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              {SLASH_HINTS.slice(0, 4).map((h) => (
                <button
                  key={h.cmd}
                  type="button"
                  onClick={() => setGoalInput(`${h.cmd} `)}
                  className="rounded-md bg-atlas-elevated px-2 py-1 text-[11px] font-mono text-atlas-accent hover:bg-atlas-accent/15"
                >
                  {h.cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'ml-6 bg-atlas-accent text-white'
                : 'mr-2 bg-atlas-elevated text-atlas-text border border-atlas-border'
            }`}
          >
            {m.content}
          </div>
        ))}

        {activeRun && activeRun.steps.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-atlas-muted">
              <span>Live Execution Timeline</span>
              <button
                type="button"
                onClick={() => setOverlayView('runs', activeRun.id)}
                className="text-atlas-accent hover:underline"
              >
                Open Replay
              </button>
            </div>
            {activeRun.steps.map((step: AgentStep) => (
              <div
                key={step.id}
                className="rounded-lg border border-atlas-border bg-atlas-bg/70 p-2 text-[11px] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-atlas-text truncate">
                    #{step.stepIndex} {step.summary}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      step.verificationOutcome === 'passed'
                        ? 'bg-atlas-success/15 text-atlas-success'
                        : step.verificationOutcome === 'failed'
                        ? 'bg-atlas-danger/15 text-atlas-danger'
                        : 'bg-atlas-elevated text-atlas-muted'
                    }`}
                  >
                    {step.verificationOutcome || step.phase}
                  </span>
                </div>
                <p className="text-atlas-muted">{step.decisionExplanation}</p>
                {step.evidence && (
                  <p className="text-[10px] font-mono text-atlas-muted/90 truncate">{step.evidence}</p>
                )}
                {step.injectionWarnings.length > 0 && (
                  <div className="flex items-center gap-1 rounded bg-atlas-warning/15 px-1.5 py-0.5 text-[10px] text-atlas-warning">
                    <ShieldAlert className="h-3 w-3 shrink-0" />
                    <span>Advisory: Suspicious prompt-like page text isolated</span>
                  </div>
                )}
                {stepScreenshots[step.id] && (
                  <img
                    src={stepScreenshots[step.id]}
                    alt={`Step ${step.stepIndex} preview`}
                    className="mt-1 max-h-28 w-full rounded border border-atlas-border object-cover"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {streamBuffer && (
          <div className="rounded-xl border border-atlas-accent/40 bg-atlas-elevated/70 p-3 text-xs whitespace-pre-wrap">
            {streamBuffer}
          </div>
        )}

        {activeRun?.failureReason && activeRun.status !== 'completed' && (
          <div className="flex items-start gap-2 rounded-xl border border-atlas-danger/40 bg-atlas-danger/10 p-2.5 text-xs text-atlas-danger">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{activeRun.failureReason}</span>
          </div>
        )}

        <div ref={timelineEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={(e) => void handleSubmit(e)} className="border-t border-atlas-border p-2.5 space-y-2">
        {goalInput.startsWith('/') && (
          <div className="flex flex-wrap gap-1">
            {SLASH_HINTS.filter((h) => h.cmd.startsWith(goalInput.split(' ')[0])).map((h) => (
              <button
                key={h.cmd}
                type="button"
                onClick={() => setGoalInput(`${h.cmd} `)}
                className="rounded bg-atlas-elevated px-2 py-0.5 text-[10px] text-atlas-accent hover:bg-atlas-accent/20"
              >
                {h.cmd} — {h.desc}
              </button>
            ))}
          </div>
        )}
        {voiceError && <div className="text-[11px] text-atlas-warning">{voiceError}</div>}
        <div className="flex items-end gap-1.5 rounded-xl border border-atlas-border bg-atlas-bg p-2">
          <textarea
            rows={2}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder={`Ask or instruct Atlas (${agentMode} mode, / for commands)...`}
            className="flex-1 resize-none bg-transparent text-xs text-atlas-text placeholder:text-atlas-muted outline-none"
          />
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            title={voiceSupported ? 'Voice input' : 'Voice input unavailable in this environment'}
            className={`rounded-lg p-2 ${
              recording
                ? 'bg-atlas-danger text-white animate-pulse'
                : 'text-atlas-muted hover:bg-atlas-elevated disabled:opacity-30'
            }`}
          >
            {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="submit"
            disabled={!goalInput.trim()}
            className="rounded-lg bg-atlas-accent p-2 text-white hover:opacity-90 disabled:opacity-40"
            aria-label="Send goal to Atlas"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
};
