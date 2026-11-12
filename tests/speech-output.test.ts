import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BobMessage } from "@/lib/bob/types";

// Minimal speechSynthesis fake: records what is spoken and cancelled.
const log: string[] = [];
class FakeUtterance {
  text: string;
  volume = 1;
  lang = "";
  voice: unknown;
  rate = 1;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (e: unknown) => void;
  constructor(t: string) {
    this.text = t;
  }
}
const synth = {
  speak: (u: FakeUtterance) => {
    log.push(`speak:${u.text}`);
    u.onstart?.();
  },
  cancel: () => log.push("cancel"),
  getVoices: () => [
    { lang: "en-US", localService: true, name: "US" },
    { lang: "en-GB", localService: true, name: "Daniel" },
  ],
};
(globalThis as unknown as { window: unknown }).window = { speechSynthesis: synth };
(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;

const out = await import("@/lib/voice/speech-output");

beforeEach(() => {
  log.length = 0;
  out.setRecording(false);
  out.stopSpeaking();
  log.length = 0;
  vi.useFakeTimers();
});

describe("spoken replies", () => {
  it("plays one reply at a time", () => {
    out.speakReply("a", "First");
    out.speakReply("b", "Second");
    vi.runAllTimers();
    // Each new reply cancels whatever was playing before it starts.
    expect(log.filter((l) => l === "cancel").length).toBeGreaterThanOrEqual(2);
    expect(log.at(-1)).toBe("speak:Second");
  });

  it("holds a reply while recording and plays it when recording ends", () => {
    out.setRecording(true);
    out.speakReply("a", "Held reply");
    vi.runAllTimers();
    expect(log.some((l) => l.startsWith("speak:"))).toBe(false);
    out.setRecording(false);
    vi.runAllTimers();
    expect(log.at(-1)).toBe("speak:Held reply");
  });

  it("stops playback as soon as a new recording starts", () => {
    out.speakReply("a", "Playing");
    vi.runAllTimers();
    log.length = 0;
    out.setRecording(true);
    expect(log).toContain("cancel");
  });

  it("a newer request drops a held reply", () => {
    out.setRecording(true);
    out.speakReply("a", "Old");
    out.clearPendingReply();
    out.setRecording(false);
    vi.runAllTimers();
    expect(log.some((l) => l.startsWith("speak:"))).toBe(false);
  });
});

describe("what Bob says", () => {
  const draft: BobMessage = {
    id: "m1",
    role: "assistant",
    createdAt: "",
    text: "Here's a draft to Hannah Whitfield about the kitchen renovation. Email isn't connected yet, so I can't send it — copy it, or save it on the enquiry.",
    action: {
      id: "act1",
      tool: "save_email_draft",
      category: "internal",
      title: "Draft reply",
      lines: [{ label: "To", value: "Hannah Whitfield <hannah@example.com>", emphasis: true }],
      notices: [],
      status: "pending",
      approveLabel: "Save draft",
      simulated: false,
      canUndo: false,
      createdAt: "",
      expiresAt: "",
    },
  } as BobMessage;

  it("speaks a short confirmation for a prepared draft, not the whole draft", () => {
    expect(out.spokenSummary([draft], "Draft a reply to Hannah about the kitchen enquiry and ask for photos")).toBe(
      "I've drafted a reply to Hannah asking for photos. It's ready to review.",
    );
  });

  it("speaks short answers in full and trims long ones to whole sentences", () => {
    expect(out.spokenSummary([{ id: "x", role: "assistant", createdAt: "", text: "5 people are waiting for a reply." }])).toBe("5 people are waiting for a reply.");
    const long = "One sentence here. ".repeat(30);
    const s = out.spokenSummary([{ id: "y", role: "assistant", createdAt: "", text: long }]);
    expect(s.length).toBeLessThanOrEqual(240);
    expect(s.endsWith(".")).toBe(true);
  });
});
