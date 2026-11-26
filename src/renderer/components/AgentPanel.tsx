import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSearch,
  GitCompare,
  Globe,
  Hand,
  Lock,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
  XCircle
} from 'lucide-react';
import type { AgentMode, AgentStep } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';
import { AgentMessageContent } from './AgentMessageContent';

const SLASH_HINTS = [
  { cmd: '/summarize', desc: 'Summarize active page' },
  { cmd: '/extract', desc: 'Extract structured data' },
  { cmd: '/compare', desc: 'Compare open tabs' },
  { cmd: '/research', desc: 'Multi-source research' },
  { cmd: '/pause', desc: 'Pause active run' },
  { cmd: '/resume', desc: 'Resume paused run' },
  { cmd: '/stop', desc: 'Stop active run' },
  { cmd: '/help', desc: 'Show commands' }
];

const MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  ask: 'Read-only synthesis grounded in active or selected tabs',
  assist: 'Proposes and confirms interactive page actions step by step',
  agent: 'Multi-step browser automation with explicit permission gates',
  takeover: 'Automation paused for direct manual control in viewport'
};

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
    setAgentPanelOpen,
    tabs,
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
    providerStatus,
    settings,
    selectedContextTabIds,
    skillSuggestion,
    setSkillSuggestion,
    proactiveSuggestions,
    setProactiveSuggestions,
    pushToast,
    setOverlayView
  } = useAtlasStore();

  const [goalInput, setGoalInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [stepScreenshots, setStepScreenshots] = useState<Record<string, string>>({});
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const lastSpokenRunRef = useRef<string | null>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((res) => {
          setMicPermission(res.state);
          res.onchange = () => setMicPermission(res.state);
        })
        .catch(() => setMicPermission('unknown'));
    }
  }, []);

  useEffect(() => {
    if (
      settings?.voiceSpokenResponsesEnabled &&
      activeRun?.status === 'completed' &&
      activeRun.finalAnswer &&
      lastSpokenRunRef.current !== activeRun.id &&
      typeof window.speechSynthesis !== 'undefined'
    ) {
      lastSpokenRunRef.current = activeRun.id;
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(activeRun.finalAnswer.slice(0, 600));
      utt.onstart = () => setSpeaking(true);
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    }
  }, [activeRun?.status, activeRun?.id, settings?.voiceSpokenResponsesEnabled]);

  const SpeechRecognitionCtor =
    (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      }
    ).SpeechRecognition ||
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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isNewTab = !activeTab?.url || activeTab.url === 'about:blank' || activeTab.url === 'atlas://newtab';
  const activeHost = (() => {
    if (isNewTab || !activeTab?.url) return '';
    try {
      return new URL(activeTab.url).hostname;
    } catch {
      return '';
    }
  })();

  const isRunning =
    activeRun &&
    ['planning', 'running', 'paused', 'awaiting_confirmation', 'awaiting_hitl'].includes(activeRun.status);

  const runGoal = async (goalText: string, overrideMode?: AgentMode) => {
    const goal = goalText.trim();
    if (!goal || !activeConversationId) return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    await window.atlas.startAgentRun({
      conversationId: activeConversationId,
      tabId: activeTabId,
      goal,
      mode: overrideMode ?? agentMode,
      selectedTabIds: selectedContextTabIds.length > 0 ? selectedContextTabIds : undefined
    });
    const refreshed = await window.atlas.getMessages(activeConversationId);
    setMessages(refreshed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const goal = goalInput.trim();
    if (!goal || !activeConversationId) return;
    setGoalInput('');
    await runGoal(goal);
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  const toggleVoice = () => {
    if (!SpeechRecognitionCtor) {
      setVoiceError('Speech input is unsupported on this runtime.');
      return;
    }
    setVoiceError(null);
    window.speechSynthesis?.cancel();
    setSpeaking(false);
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
        if (/^(stop|cancel|abort|halt)(\s+agent|\s+task)?$/i.test(transcript) && activeRun && isRunning) {
          void window.atlas.stopAgentRun(activeRun.id);
          rec.stop();
          setRecording(false);
          pushToast('Voice command stopped active run', 'warning');
          return;
        }
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
    const conv = await window.atlas.createConversation(`Session ${conversations.length + 1}`);
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
  const nonPrivateCount = tabs.filter((t) => !t.isPrivate).length;
  const scopeCount = selectedContextTabIds.length || nonPrivateCount;
  const providerConfigured = Boolean(
    providerStatus && (!providerStatus.isLive || !providerStatus.warning)
  );

  return (
    <aside className="flex h-full w-[372px] shrink-0 flex-col border-l border-atlas-border bg-atlas-surface text-atlas-text select-text">
      {/* Quiet Header */}
      <div className="flex h-10 items-center justify-between border-b border-atlas-border px-3">
        <select
          aria-label="Active Agent Conversation"
          value={activeConversationId || ''}
          onChange={async (e) => {
            const id = e.target.value;
            setActiveConversationId(id);
            const msgs = await window.atlas.getMessages(id);
            setMessages(msgs);
          }}
          className="max-w-[210px] truncate rounded-md bg-transparent px-1 py-1 text-[12.5px] font-semibold text-atlas-text hover:bg-atlas-shell outline-none cursor-pointer transition-colors"
        >
          {conversations.map((c) => (
            <option key={c.id} value={c.id} className="bg-atlas-surface text-atlas-text">
              {c.title}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            title="New Conversation"
            aria-label="New Conversation"
            className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-shell hover:text-atlas-text transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            title="Clear Conversation"
            aria-label="Clear Conversation"
            className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-shell hover:text-atlas-danger transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setAgentPanelOpen(false)}
            title="Close Assistant Panel"
            aria-label="Close Assistant Panel"
            className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-shell hover:text-atlas-text transition-colors"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="border-b border-atlas-border px-3 pt-1.5 pb-2 space-y-1.5">
        <div className="flex items-center gap-4 border-b border-atlas-border/80">
          {(['ask', 'assist', 'agent', 'takeover'] as AgentMode[]).map((m) => {
            const active = agentMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={async () => {
                  setAgentMode(m);
                  if (activeRun && isRunning) {
                    if (m === 'takeover') {
                      await window.atlas.takeoverAgentRun(activeRun.id);
                    } else {
                      await window.atlas.setAgentMode(activeRun.id, m);
                    }
                  }
                }}
                className={`relative pb-1.5 text-[12px] font-medium capitalize transition-colors ${
                  active ? 'text-atlas-accent font-semibold' : 'text-atlas-muted hover:text-atlas-text'
                }`}
              >
                {m}
                {active && (
                  <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-atlas-accent" />
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-atlas-muted leading-snug">{MODE_DESCRIPTIONS[agentMode]}</div>
      </div>

      {/* Browser Context Strip */}
      <div className="border-b border-atlas-border bg-atlas-shell/45 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11.5px]">
          <div className="flex items-center gap-1.5 min-w-0">
            {activeTab?.isPrivate ? (
              <>
                <Lock className="h-3 w-3 shrink-0 text-atlas-muted" strokeWidth={1.75} />
                <span className="truncate font-medium text-atlas-secondary">Private tab — isolated</span>
              </>
            ) : (
              <>
                {activeTab?.favicon ? (
                  <img src={activeTab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0 text-atlas-muted" strokeWidth={1.75} />
                )}
                <span className="truncate font-medium text-atlas-text">
                  {isNewTab ? 'Atlas Start Page' : activeTab?.title || activeHost}
                </span>
                {activeHost && (
                  <span className="shrink-0 font-mono text-[10.5px] text-atlas-muted">{activeHost}</span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOverlayView('intelligence')}
            className="shrink-0 text-[11px] font-medium text-atlas-accent hover:underline"
            title="Select tab context and open Research Workspace"
          >
            {scopeCount} {scopeCount === 1 ? 'tab' : 'tabs'}
          </button>
        </div>

        {/* Clean Page Quick Actions (Typography links, no stacked cards) */}
        {activeTab && !activeTab.isPrivate && !isNewTab && (
          <div className="flex items-center gap-3 pt-0.5 text-[11.5px]">
            <QuickActionLink
              icon={<BookOpenCheck className="h-3 w-3" />}
              label="Summarize"
              disabled={Boolean(isRunning)}
              onClick={() => void runGoal('/summarize', 'ask')}
            />
            <QuickActionLink
              icon={<FileSearch className="h-3 w-3" />}
              label="Extract"
              disabled={Boolean(isRunning)}
              onClick={() => void runGoal('/extract', 'ask')}
            />
            <QuickActionLink
              icon={<GitCompare className="h-3 w-3" />}
              label="Compare"
              disabled={Boolean(isRunning) || nonPrivateCount < 2}
              onClick={() => void runGoal('/compare', 'ask')}
            />
            <QuickActionLink
              icon={<Sparkles className="h-3 w-3" />}
              label="Research"
              onClick={() => setOverlayView('intelligence')}
            />
          </div>
        )}
      </div>

      {/* Compact Execution Status Strip */}
      {activeRun && (
        <div className="flex items-center justify-between gap-2 border-b border-atlas-border bg-atlas-bg/65 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isRunning
                  ? 'bg-atlas-accent animate-pulse'
                  : activeRun.status === 'completed'
                  ? 'bg-atlas-success'
                  : activeRun.status === 'failed'
                  ? 'bg-atlas-danger'
                  : 'bg-atlas-warning'
              }`}
            />
            <span className="text-[11.5px] font-semibold text-atlas-text truncate">
              {activeRun.status === 'awaiting_confirmation' || activeRun.status === 'awaiting_hitl'
                ? 'Awaiting approval'
                : activeRun.status === 'paused'
                ? 'Paused (Takeover)'
                : activeRun.status.charAt(0).toUpperCase() + activeRun.status.slice(1).replace(/_/g, ' ')}
            </span>
            <span className="text-[10.5px] text-atlas-muted">
              · {(activeRun.totalInputTokens + activeRun.totalOutputTokens).toLocaleString()} tok
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isRunning && activeRun.status !== 'paused' && activeRun.status !== 'awaiting_hitl' && (
              <button
                type="button"
                onClick={() => void window.atlas.pauseAgentRun(activeRun.id)}
                title="Pause Run"
                className="rounded-md border border-atlas-border bg-atlas-surface p-1 text-atlas-muted hover:text-atlas-text"
              >
                <Pause className="h-3 w-3" />
              </button>
            )}
            {(activeRun.status === 'paused' || activeRun.status === 'awaiting_hitl') && (
              <button
                type="button"
                onClick={() => void window.atlas.resumeAgentRun(activeRun.id)}
                title="Resume Run"
                className="rounded-md border border-atlas-success/40 bg-atlas-success/10 p-1 text-atlas-success"
              >
                <Play className="h-3 w-3" />
              </button>
            )}
            {isRunning && (
              <>
                <button
                  type="button"
                  onClick={() => void window.atlas.takeoverAgentRun(activeRun.id)}
                  title="Take Manual Control"
                  className="rounded-md border border-atlas-warning/40 bg-atlas-warning/10 p-1 text-atlas-warning"
                >
                  <Hand className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void window.atlas.stopAgentRun(activeRun.id)}
                  title="Stop Agent"
                  className="rounded-md border border-atlas-danger/40 bg-atlas-danger/10 p-1 text-atlas-danger"
                >
                  <Square className="h-3 w-3" />
                </button>
              </>
            )}
            {!isRunning && activeRun.status === 'completed' && activeRun.steps.length > 0 && (
              <button
                type="button"
                onClick={() => void handleSaveSkill()}
                title="Save as Skill"
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-atlas-accent hover:bg-atlas-accent/10"
              >
                <Save className="h-3 w-3" /> Save Skill
              </button>
            )}
            {!isRunning && activeRun.status === 'failed' && activeConversationId && (
              <button
                type="button"
                onClick={() => void runGoal(activeRun.goal)}
                title="Retry Task"
                className="flex items-center gap-1 rounded-md border border-atlas-border bg-atlas-surface px-2 py-0.5 text-[11px] font-medium text-atlas-text hover:bg-atlas-shell"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editorial Conversation & Progress Timeline */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
        {activeRun && (activeRun.subgoals.length > 0 || subAgentList.length > 0) && (
          <div className="space-y-1.5 border-b border-atlas-border pb-3">
            {activeRun.subgoals.map((sg) => (
              <div key={sg.id} className="flex items-start gap-1.5 text-[11.5px]">
                {sg.status === 'completed' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-atlas-success mt-0.5" />
                ) : sg.status === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-atlas-danger mt-0.5" />
                ) : (
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      sg.status === 'in_progress' ? 'bg-atlas-accent animate-pulse' : 'bg-atlas-border-strong'
                    }`}
                  />
                )}
                <span className={sg.status === 'completed' ? 'text-atlas-muted line-through' : 'text-atlas-text'}>
                  {sg.description}
                </span>
              </div>
            ))}

            {subAgentList.length > 0 && (
              <div className="pt-1.5 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-atlas-muted">
                  Parallel Sub-Tasks
                </div>
                {subAgentList.map((sa) => (
                  <div key={sa.subAgentId} className="flex items-center justify-between text-[11px]">
                    <span className="truncate flex-1 text-atlas-secondary">{sa.task}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] text-atlas-muted uppercase">
                      {sa.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.length === 0 && !activeRun && (
          <div className="py-6 space-y-3">
            <p className="text-[12.5px] leading-relaxed text-atlas-secondary">
              Ask questions grounded in open tabs, synthesize research reports, or instruct multi-step browser tasks with approval gates.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] font-mono text-atlas-accent">
              {['/summarize', '/extract', '/compare', '/research'].map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => setGoalInput(`${cmd} `)}
                  className="hover:underline"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-xl border border-atlas-border bg-atlas-shell px-3 py-2 text-[13px] leading-relaxed text-atlas-text whitespace-pre-wrap [overflow-wrap:anywhere]">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-1 border-l-2 border-atlas-border pl-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-atlas-muted">
                Atlas
              </div>
              <AgentMessageContent content={m.content} />
            </div>
          )
        )}

        {/* Collapsible Tool Execution Log */}
        {activeRun && activeRun.steps.length > 0 && (
          <div className="border-t border-atlas-border pt-2.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setTimelineCollapsed((c) => !c)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-atlas-secondary hover:text-atlas-text"
              >
                {timelineCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>Activity Log ({activeRun.steps.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setOverlayView('runs', activeRun.id)}
                className="text-[11px] font-medium text-atlas-accent hover:underline"
              >
                Replay
              </button>
            </div>

            {!timelineCollapsed && (
              <div className="mt-2 space-y-2 border-l border-atlas-border pl-2.5">
                {activeRun.steps.map((step: AgentStep) => (
                  <div key={step.id} className="space-y-0.5 text-[11.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-medium text-atlas-text truncate">
                        #{step.stepIndex} {step.summary}
                      </span>
                      <span
                        className={`shrink-0 text-[10px] font-semibold uppercase ${
                          step.verificationOutcome === 'passed'
                            ? 'text-atlas-success'
                            : step.verificationOutcome === 'failed'
                            ? 'text-atlas-danger'
                            : 'text-atlas-muted'
                        }`}
                      >
                        {step.verificationOutcome || step.phase}
                      </span>
                    </div>
                    <p className="text-atlas-muted leading-snug [overflow-wrap:anywhere]">
                      {step.decisionExplanation}
                    </p>
                    {step.evidence && (
                      <p className="font-mono text-[10.5px] text-atlas-muted/85 truncate">{step.evidence}</p>
                    )}
                    {step.injectionWarnings.length > 0 && (
                      <div className="flex items-center gap-1 text-[10.5px] text-atlas-warning">
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                        <span>Untrusted prompt text isolated</span>
                      </div>
                    )}
                    {stepScreenshots[step.id] && (
                      <img
                        src={stepScreenshots[step.id]}
                        alt={`Step ${step.stepIndex}`}
                        className="mt-1 max-h-24 w-full rounded-lg border border-atlas-border object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {streamBuffer && (
          <div className="space-y-1 border-l-2 border-atlas-accent pl-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-atlas-accent">
              Atlas · Writing
            </div>
            <AgentMessageContent content={streamBuffer} />
          </div>
        )}

        {activeRun?.failureReason && activeRun.status !== 'completed' && (
          <div className="flex items-start gap-2 rounded-lg border border-atlas-danger/35 bg-atlas-danger/8 p-2.5 text-[12px] text-atlas-danger [overflow-wrap:anywhere]">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{activeRun.failureReason}</span>
          </div>
        )}

        <div ref={timelineEndRef} />
      </div>

      {/* Focused Composer */}
      <form onSubmit={(e) => void handleSubmit(e)} className="border-t border-atlas-border bg-atlas-shell/40 p-2.5 space-y-2">
        {goalInput.startsWith('/') && (
          <div className="flex flex-wrap gap-1">
            {SLASH_HINTS.filter((h) => h.cmd.startsWith(goalInput.split(' ')[0])).map((h) => (
              <button
                key={h.cmd}
                type="button"
                onClick={() => setGoalInput(`${h.cmd} `)}
                className="rounded-md border border-atlas-border bg-atlas-surface px-2 py-0.5 text-[11px] text-atlas-accent hover:bg-atlas-shell"
              >
                {h.cmd}
              </button>
            ))}
          </div>
        )}

        {skillSuggestion && (
          <div className="rounded-lg border border-atlas-border bg-atlas-surface p-2.5 text-xs space-y-1.5">
            <div className="font-medium text-atlas-text">
              Save &ldquo;{skillSuggestion.suggestedName}&rdquo; as reusable skill?
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const saved = await window.atlas.recordSkillFromRun(
                    skillSuggestion.runId,
                    skillSuggestion.suggestedName,
                    skillSuggestion.description
                  );
                  setSkillSuggestion(null);
                  pushToast(`Saved skill "${saved.name}"`, 'success');
                }}
                className="rounded-md bg-atlas-accent px-2.5 py-1 text-[11px] font-medium text-atlas-accent-fg"
              >
                Save Skill
              </button>
              <button
                type="button"
                onClick={() => setSkillSuggestion(null)}
                className="rounded-md border border-atlas-border px-2.5 py-1 text-[11px] text-atlas-secondary hover:bg-atlas-shell"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {proactiveSuggestions.length > 0 && (
          <div className="space-y-1">
            {proactiveSuggestions.map((ps) => (
              <div
                key={ps.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-atlas-border bg-atlas-surface px-2.5 py-1.5 text-[11px]"
              >
                <span className="truncate font-medium text-atlas-text">{ps.title}</span>
                <button
                  type="button"
                  onClick={async () => {
                    setProactiveSuggestions(proactiveSuggestions.filter((x) => x.id !== ps.id));
                    if (ps.payload.command && activeConversationId) {
                      await runGoal(String(ps.payload.command), 'ask');
                    } else if (ps.payload.runId) {
                      await window.atlas.resumeCheckpoint(String(ps.payload.runId));
                    }
                  }}
                  className="shrink-0 font-medium text-atlas-accent hover:underline"
                >
                  {ps.actionLabel}
                </button>
              </div>
            ))}
          </div>
        )}

        {voiceError && <div className="text-[11px] text-atlas-warning px-1">{voiceError}</div>}

        <div className="rounded-xl border border-atlas-border bg-atlas-surface px-2.5 py-2 focus-within:border-atlas-accent/75 focus-within:ring-2 focus-within:ring-atlas-accent/15 transition-all">
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
            placeholder={`Instruct Atlas (${agentMode}, / for commands)...`}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-atlas-text placeholder:text-atlas-muted outline-none"
          />
          <div className="mt-1 flex items-center justify-between pt-1.5 border-t border-atlas-border/70">
            <button
              type="button"
              onClick={() => setOverlayView('settings')}
              title={providerStatus?.warning || 'AI Provider Settings'}
              className="flex items-center gap-1.5 text-[11px] text-atlas-muted hover:text-atlas-text transition-colors"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  providerConfigured
                    ? providerStatus?.isLive
                      ? 'bg-atlas-success'
                      : 'bg-atlas-muted'
                    : 'bg-atlas-warning'
                }`}
              />
              <span className="truncate max-w-[180px]">
                {providerConfigured
                  ? providerStatus?.isLive
                    ? providerStatus.model
                    : 'Offline Mock'
                  : 'Configure Provider'}
              </span>
            </button>

            <div className="flex items-center gap-1">
              {speaking && (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  title="Stop speaking"
                  className="rounded-md p-1 text-atlas-warning hover:bg-atlas-shell"
                >
                  <VolumeX className="h-3.5 w-3.5" />
                </button>
              )}
              {!speaking && settings?.voiceSpokenResponsesEnabled && (
                <Volume2 className="h-3.5 w-3.5 text-atlas-muted mr-1" aria-label="Voice output active" />
              )}
              <button
                type="button"
                onClick={toggleVoice}
                disabled={!voiceSupported}
                title={voiceSupported ? `Voice input (${micPermission})` : 'Voice input unsupported'}
                className={`rounded-md p-1.5 transition-colors ${
                  recording
                    ? 'bg-atlas-danger text-white'
                    : 'text-atlas-muted hover:bg-atlas-shell hover:text-atlas-text disabled:opacity-30'
                }`}
              >
                {recording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
              <button
                type="submit"
                disabled={!goalInput.trim()}
                className="rounded-lg bg-atlas-accent p-1.5 text-atlas-accent-fg hover:opacity-90 disabled:opacity-30 transition-opacity"
                aria-label="Send goal to Atlas"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </form>
    </aside>
  );
};

const QuickActionLink: React.FC<{
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="inline-flex items-center gap-1 font-medium text-atlas-secondary hover:text-atlas-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
  >
    <span className="text-atlas-accent">{icon}</span>
    <span>{label}</span>
  </button>
);
