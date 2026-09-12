import type { ChatMessage, CourseContext, StructuredProfile } from "../types";
import { startVoiceSession } from "../api";
import { downsample, floatTo16BitPcm, PcmPlayer, toBase64 } from "./pcm";

export type TalkStatus = "connecting" | "listening" | "speaking" | "idle" | "error";

export interface VoiceTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
}

interface Handlers {
  onTurn: (turn: VoiceTurn) => void;
  onStatus: (status: TalkStatus) => void;
  onError: (message: string) => void;
}

export interface TalkContext {
  history: ChatMessage[];
  /** Set at the review point so Scotty edits the recap instead of interviewing again. */
  review?: StructuredProfile | null;
}

export interface TalkSession {
  stop: () => void;
  /** Let Scotty finish the sentence he is already speaking, then hang up. */
  stopAfterSpeech: () => void;
  /** False when Scotty is mid-answer, so the caller can keep the draft instead of losing it. */
  sendText: (text: string) => boolean;
}

const RATE = 24000;
const VAD = { type: "server_vad", threshold: 0.5, silence_duration_ms: 500, prefix_padding_ms: 300 };
/** Scotty's own voice would retrigger the mic, so input stays shut until playback drains. */
const DRAIN_MS = 150;
const AUDIO_GAP_MS = 400;
const TICK_MS = 100;
/** Roughly conversational speaking pace, used to pace captions against the audio. */
const CHARS_PER_SEC = 16;
const CAPTION_LEAD = 8;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function eventAudio(ev: Record<string, unknown>): string {
  const raw = ev.delta ?? ev.audio;
  if (typeof raw === "string") return raw;
  const nested = raw as { audio?: unknown; delta?: unknown } | null;
  return str(nested?.audio) || str(nested?.delta);
}

function eventText(ev: Record<string, unknown>): string {
  const item = ev.item as { transcript?: unknown; content?: Array<Record<string, unknown>> } | undefined;
  const part = item?.content?.[0];
  return (
    str(ev.transcript) ||
    str(ev.delta) ||
    str(ev.text) ||
    str(item?.transcript) ||
    str(part?.transcript) ||
    str(part?.text)
  );
}

/**
 * Streamed pieces arrive either cumulative or incremental. Never trim a piece,
 * the leading space of " like" is what keeps words apart.
 */
function grow(prev: string, piece: string): string {
  if (!piece) return prev;
  if (!prev || piece.startsWith(prev)) return piece;
  return prev + piece;
}

/** Cut the caption at a word boundary so a half-word never flashes on screen. */
function upTo(text: string, chars: number): string {
  if (chars >= text.length) return text;
  if (chars <= 0) return "";
  const space = text.lastIndexOf(" ", chars);
  return space > 0 ? text.slice(0, space) : "";
}

export async function startTalk(
  studentName: string,
  course: CourseContext,
  context: TalkContext,
  handlers: Handlers,
): Promise<TalkSession> {
  handlers.onStatus("connecting");
  const history = context.history;
  const session = await startVoiceSession(studentName, course, context.review);
  const ws = new WebSocket(session.ws_url, [`xai-client-secret.${session.token}`]);
  const player = new PcmPlayer();

  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let captureCtx: AudioContext | null = null;
  let ticker: number | null = null;
  let closed = false;
  let stopping = false;
  let replying = false;
  let lastAudioAt = 0;
  let status: TalkStatus = "connecting";
  let seq = 0;
  /** A thread already on screen counts as greeted, so turning voice on never repeats it. */
  let greeted = history.some((m) => m.content.trim());
  /** What the student said this turn. Held back until the transcript is final. */
  let heard: { id: string; text: string; emitted: string } | null = null;
  /** Scotty's reply: full transcript so far, plus how much of it has been shown. */
  let reply: { id: string; text: string; shown: string; spoken: boolean; ended: boolean } | null = null;

  function sendJson(payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function setStatus(next: TalkStatus) {
    if (next === status) return;
    status = next;
    handlers.onStatus(next);
  }

  function scottyBusy() {
    return replying || player.queuedMs() > DRAIN_MS || performance.now() - lastAudioAt < AUDIO_GAP_MS;
  }

  /**
   * Render the student's line once, as the transcriber finally heard it. The turn stays
   * open so a corrected transcript rewrites this bubble instead of adding a second one;
   * only speech_started begins a new one.
   */
  function flushHeard() {
    if (!heard) return;
    const text = heard.text.trim();
    if (!text || text === heard.emitted) return;
    heard.emitted = text;
    handlers.onTurn({ id: heard.id, role: "user", text, done: true });
  }

  /** Reveal Scotty's transcript at the pace of his audio, like captions. */
  function paceCaption() {
    if (!reply) return;
    const full = reply.text.trim();
    if (reply.ended && !scottyBusy()) {
      if (full) handlers.onTurn({ id: reply.id, role: "assistant", text: full, done: true });
      reply = null;
      return;
    }
    if (!full) return;
    const budget = reply.spoken ? (player.playedMs() / 1000) * CHARS_PER_SEC + CAPTION_LEAD : full.length;
    const next = upTo(full, Math.floor(budget));
    if (!next || next === reply.shown) return;
    reply.shown = next;
    handlers.onTurn({ id: reply.id, role: "assistant", text: next, done: false });
  }

  function teardown() {
    if (closed) return;
    closed = true;
    if (ticker) window.clearInterval(ticker);
    processor?.disconnect();
    source?.disconnect();
    void captureCtx?.close();
    stream?.getTracks().forEach((t) => t.stop());
    player.stop();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    setStatus("idle");
  }

  function tick() {
    paceCaption();
    if (stopping) {
      if (!scottyBusy()) teardown();
      return;
    }
    setStatus(scottyBusy() ? "speaking" : "listening");
  }

  async function openMic() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    captureCtx = new AudioContext();
    source = captureCtx.createMediaStreamSource(stream);
    processor = captureCtx.createScriptProcessor(2048, 1, 1);
    const silent = captureCtx.createGain();
    silent.gain.value = 0;
    processor.onaudioprocess = (ev) => {
      if (closed || stopping || scottyBusy()) return;
      const down = downsample(ev.inputBuffer.getChannelData(0), captureCtx?.sampleRate ?? 48000, RATE);
      sendJson({ type: "input_audio_buffer.append", audio: toBase64(floatTo16BitPcm(down)) });
    };
    source.connect(processor);
    processor.connect(silent);
    silent.connect(captureCtx.destination);
    ticker = window.setInterval(tick, TICK_MS);
    setStatus("listening");
  }

  ws.onerror = () => {
    handlers.onError("The voice connection dropped.");
    setStatus("error");
  };

  ws.onclose = () => {
    if (!closed) teardown();
  };

  ws.onopen = async () => {
    sendJson({
      type: "session.update",
      session: {
        voice: session.voice,
        instructions: session.instructions,
        reasoning: { effort: "none" },
        turn_detection: session.turn_detection ?? VAD,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            transport: "json",
            transcription: { model: "grok-transcribe", language_hint: "en" },
          },
          output: { format: { type: "audio/pcm", rate: RATE }, transport: "json" },
        },
      },
    });
    // Catch Scotty up on what the student already typed so he doesn't re-ask.
    for (const past of history) {
      if (past.role !== "user" || !past.content.trim()) continue;
      sendJson({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: past.content }] },
      });
    }
    try {
      await openMic();
    } catch {
      handlers.onError("Microphone permission is needed for talk mode.");
      setStatus("error");
      teardown();
    }
  };

  ws.onmessage = (msg) => {
    if (typeof msg.data !== "string") return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      return;
    }
    const type = String(ev.type ?? "");

    if (type === "session.updated") {
      if (greeted) return;
      greeted = true;
      sendJson({ type: "response.create" });
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      flushHeard();
      heard = { id: `u${++seq}`, text: "", emitted: "" };
      return;
    }

    if (type.startsWith("conversation.item.input_audio_transcription")) {
      if (!heard) heard = { id: `u${++seq}`, text: "", emitted: "" };
      const piece = eventText(ev);
      if (type.endsWith(".completed")) {
        // The completed event carries the corrected full transcript; prefer it outright.
        heard.text = piece.trim() || heard.text;
        flushHeard();
        return;
      }
      heard.text = grow(heard.text, piece);
      return;
    }

    if (type === "response.created") {
      flushHeard();
      replying = true;
      player.startPhrase();
      reply = { id: `s${++seq}`, text: "", shown: "", spoken: false, ended: false };
      setStatus("speaking");
      return;
    }

    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const audio = eventAudio(ev);
      if (!audio) return;
      lastAudioAt = performance.now();
      if (reply) reply.spoken = true;
      void player.pushBase64(audio);
      return;
    }

    if (
      type.endsWith("_transcript.delta") ||
      type === "response.text.delta" ||
      type === "response.output_text.delta"
    ) {
      if (!reply) reply = { id: `s${++seq}`, text: "", shown: "", spoken: false, ended: false };
      reply.text = grow(reply.text, eventText(ev));
      return;
    }

    // The final transcript is the corrected one; trust it over the stitched deltas.
    if (type.endsWith("_transcript.done") || type === "response.output_text.done") {
      const final = eventText(ev).trim();
      if (reply && final) reply.text = final;
      return;
    }

    if (type === "response.done" || type === "response.completed") {
      replying = false;
      flushHeard();
      if (reply) reply.ended = true;
      return;
    }

    if (type === "error") {
      replying = false;
      const err = ev.error as { message?: unknown } | undefined;
      handlers.onError(str(err?.message) || "Voice hit a snag.");
    }
  };

  function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || closed || stopping || scottyBusy()) return false;
    sendJson({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
    });
    sendJson({ type: "response.create" });
    return true;
  }

  function stopAfterSpeech() {
    if (closed) return;
    if (!scottyBusy()) {
      teardown();
      return;
    }
    stopping = true;
  }

  return { stop: teardown, stopAfterSpeech, sendText };
}
